package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// 风控面板：展示当前处于「代码执行自动限速」状态的用户，
// 触发次数与最近一次被判定为代码执行的工具调用样本来自触发时写入的管理日志。

type riskLimitedUserItem struct {
	UserId           int      `json:"user_id"`
	Username         string   `json:"username"`
	DisplayName      string   `json:"display_name"`
	Status           int      `json:"status"`
	Group            string   `json:"group"`
	Model            string   `json:"model"`
	RateLimitRpm     int      `json:"rate_limit_rpm"`
	RateLimitUntil   int64    `json:"rate_limit_until"`
	RemainingSeconds int64    `json:"remaining_seconds"`
	TriggerCount     int      `json:"trigger_count"`
	LastTriggeredAt  int64    `json:"last_triggered_at"`
	RecentCalls      []string `json:"recent_calls"`
}

type riskUserRow struct {
	Id             int
	Username       string
	DisplayName    string
	Status         int
	RateLimitRpm   int
	RateLimitUntil int64
}

// GetRiskLimitedUsers 列出所有限速中的用户，可传 keyword 按 UID / 用户名过滤。
func GetRiskLimitedUsers(c *gin.Context) {
	now := time.Now().Unix()
	query := model.DB.Model(&model.User{}).
		Select("id, username, display_name, status, rate_limit_rpm, rate_limit_until").
		Where("rate_limit_until > ?", now)

	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
			query = query.Where("id = ?", id)
		} else {
			pattern := "%" + keyword + "%"
			query = query.Where("username LIKE ? OR display_name LIKE ?", pattern, pattern)
		}
	}

	var rows []riskUserRow
	if err := query.Order("rate_limit_until DESC").Limit(500).Scan(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]riskLimitedUserItem, 0, len(rows))
	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		items = append(items, riskLimitedUserItem{
			UserId:           row.Id,
			Username:         row.Username,
			DisplayName:      row.DisplayName,
			Status:           row.Status,
			RateLimitRpm:     row.RateLimitRpm,
			RateLimitUntil:   row.RateLimitUntil,
			RemainingSeconds: row.RateLimitUntil - now,
			RecentCalls:      make([]string, 0),
		})
		userIds = append(userIds, row.Id)
	}
	if len(userIds) > 0 {
		attachRiskTriggerLogs(items, userIds)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"items": items, "total": len(items)},
	})
}

type riskTriggerLogRow struct {
	UserId    int
	CreatedAt int64
	Other     string
}

// attachRiskTriggerLogs 汇总每个用户的触发次数，并取最近一次触发日志中的分组、
// 模型与工具调用样本。日志按 id 倒序，第一次遇到的即为最近一次。
func attachRiskTriggerLogs(items []riskLimitedUserItem, userIds []int) {
	var logs []riskTriggerLogRow
	err := model.LOG_DB.Model(&model.Log{}).
		Select("user_id, created_at, other").
		Where("user_id IN ? AND type = ? AND content LIKE ?", userIds, model.LogTypeManage, "%执行代码累计%").
		Order("id DESC").Limit(2000).Scan(&logs).Error
	if err != nil {
		common.SysLog("failed to load risk trigger logs: " + err.Error())
		return
	}

	index := make(map[int]int, len(items))
	for i := range items {
		index[items[i].UserId] = i
	}

	for _, row := range logs {
		pos, ok := index[row.UserId]
		if !ok {
			continue
		}
		item := &items[pos]
		item.TriggerCount++
		if item.LastTriggeredAt != 0 {
			continue
		}
		item.LastTriggeredAt = row.CreatedAt
		var other map[string]interface{}
		if err := common.UnmarshalJsonStr(row.Other, &other); err != nil {
			continue
		}
		adminInfo, ok := other["admin_info"].(map[string]interface{})
		if !ok {
			continue
		}
		item.Group = common.Interface2String(adminInfo["group"])
		item.Model = common.Interface2String(adminInfo["model"])
		if calls, ok := adminInfo["calls"].([]interface{}); ok {
			for _, v := range calls {
				item.RecentCalls = append(item.RecentCalls, common.Interface2String(v))
			}
		}
	}
}

type riskUnlimitRequest struct {
	UserIds []int `json:"user_ids"`
}

// BatchUnlimitRiskUsers 批量解除用户的代码执行自动风控限速。
func BatchUnlimitRiskUsers(c *gin.Context) {
	var req riskUnlimitRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || len(req.UserIds) == 0 {
		common.ApiError(c, errors.New("invalid params"))
		return
	}

	operatorId := c.GetInt("id")
	operatorName := c.GetString("username")
	seen := make(map[int]struct{}, len(req.UserIds))
	unlimited := 0
	failed := 0
	for _, userId := range req.UserIds {
		if userId <= 0 {
			continue
		}
		if _, ok := seen[userId]; ok {
			continue
		}
		seen[userId] = struct{}{}
		if err := model.ClearUserRateLimit(userId); err != nil {
			failed++
			common.SysLog("failed to clear rate limit for user " + strconv.Itoa(userId) + ": " + err.Error())
			continue
		}
		unlimited++
		model.RecordLogWithAdminInfo(userId, model.LogTypeManage, "管理员解除了该用户的自动风控限速", gin.H{
			"admin_id":       operatorId,
			"admin_username": operatorName,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"unlimited_count": unlimited, "failed_count": failed},
	})
}
