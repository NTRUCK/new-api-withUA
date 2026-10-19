package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetChannelKiroUsage 返回渠道 Kiro 模拟号池数据：配置概览、当月用量（含期初已用）、
// 按日聚合与最近消费明细。仅在渠道开启 Kiro 额度模拟时有意义。
func GetChannelKiroUsage(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelId < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的渠道 ID"})
		return
	}
	channel, err := model.GetChannelById(channelId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "渠道不存在或已被删除"})
		return
	}
	setting := channel.GetSetting()
	logUsed, daily, err := service.GetKiroCreditStats(channelId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计 credits 失败: " + err.Error()})
		return
	}
	recent, err := service.GetKiroCreditRecentLogs(channelId, 50)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "查询明细失败: " + err.Error()})
		return
	}
	used := logUsed + float64(setting.KiroCreditUsedInitial)
	limit := float64(setting.KiroCreditLimit)
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"channel_id":        channelId,
			"name":              channel.Name,
			"sim_enabled":       setting.KiroCreditSim,
			"limit":             limit,
			"used":              used,
			"log_used":          logUsed,
			"used_initial":      setting.KiroCreditUsedInitial,
			"remaining":         remaining,
			"exhausted":         setting.KiroCreditLimit > 0 && used >= limit,
			"plan_template":     setting.KiroPlanTemplate,
			"plan_count":        setting.KiroPlanCount,
			"tokens_per_credit": setting.KiroTokensPerCredit,
			"month":             time.Now().Format("2006-01"),
			"daily":             daily,
			"recent":            recent,
		},
	})
}

// UpdateChannelKiroSetting 校准模拟号池的期初已用 credits。
// 判定口径：当月日志累计 + 期初已用；校准后立即生效（内存计数下一个对账周期内可见）。
func UpdateChannelKiroSetting(c *gin.Context) {
	type kiroCalibrateReq struct {
		UsedInitial *int `json:"used_initial"`
	}
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelId < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的渠道 ID"})
		return
	}
	var req kiroCalibrateReq
	if err := c.ShouldBindJSON(&req); err != nil || req.UsedInitial == nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误：需提供 used_initial"})
		return
	}
	if *req.UsedInitial < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "期初已用不能为负数"})
		return
	}
	channel, err := model.GetChannelById(channelId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "渠道不存在或已被删除"})
		return
	}
	setting := channel.GetSetting()
	setting.KiroCreditUsedInitial = *req.UsedInitial
	channel.SetSetting(setting)
	settingJSON := ""
	if channel.Setting != nil {
		settingJSON = *channel.Setting
	}
	if err := model.DB.Model(&model.Channel{}).
		Where("id = ?", channelId).
		Update("setting", settingJSON).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "保存失败: " + err.Error()})
		return
	}
	common.SysLog(fmt.Sprintf("kiro pool calibrate: channel %d used_initial=%d by admin", channelId, *req.UsedInitial))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "校准已生效"})
}
