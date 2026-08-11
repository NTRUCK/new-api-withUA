package controller

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// GetDiceGameStatus 获取骰子游戏状态（配置、今日局数、历史记录）
func GetDiceGameStatus(c *gin.Context) {
	if !operation_setting.IsDiceGameEnabled() {
		common.ApiErrorMsg(c, "小游戏功能未启用")
		return
	}
	userId := c.GetInt("id")
	data, err := model.GetDiceGameStatus(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

type diceGamePlayRequest struct {
	Choice string `json:"choice"`
	Bet    int    `json:"bet"`
}

func GetDiceWelfareStatus(c *gin.Context) {
	data, err := model.GetDiceWelfareStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func ApplyDiceWelfare(c *gin.Context) {
	result, err := model.ApplyDiceWelfare(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

type welfareRedemptionRequest struct {
	Name       string `json:"name"`
	TotalQuota int    `json:"total_quota"`
	MaxUses    int    `json:"max_uses"`
	MinQuota   int    `json:"min_quota"`
	MaxQuota   int    `json:"max_quota"`
}

func CreateWelfareRedemption(c *gin.Context) {
	var req welfareRedemptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}
	result, err := model.CreateWelfareRedemption(c.GetInt("id"), req.Name, req.TotalQuota, req.MaxUses, req.MinQuota, req.MaxQuota)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RecordLog(c.GetInt("id"), model.LogTypeManage, fmt.Sprintf("从低保池创建拼手气红包：%s", logger.LogQuota(req.TotalQuota)))
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func PlayDiceGame(c *gin.Context) {
	if !operation_setting.IsDiceGameEnabled() {
		common.ApiErrorMsg(c, "小游戏功能未启用")
		return
	}
	userId := c.GetInt("id")

	var req diceGamePlayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}

	result, err := model.PlayDiceGame(userId, req.Choice, req.Bet)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 记录额度变动日志，便于对账
	if result.NetChange != 0 {
		outcome := "输"
		if result.Win {
			outcome = "赢"
		}
		model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf(
			"骰子猜大小：下注 %s，%s，额度净变化 %s",
			logger.LogQuota(result.Bet), outcome, logger.LogQuota(result.NetChange)))
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}
