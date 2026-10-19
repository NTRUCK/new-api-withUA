package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// ===== 内容审计管理面板 =====

// AuditPanelLogin 用独立密码换取面板票据。
func AuditPanelLogin(c *gin.Context) {
	if !operation_setting.ContentAuditPasswordConfigured() {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"code":    "audit_password_not_set",
			"message": "审计面板尚未设置访问密码，请先由站长在面板设置中设置",
		})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	if !common.ValidatePasswordAndHash(req.Password, operation_setting.ContentAuditPanelPasswordHash) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码错误"})
		return
	}
	ticket, exp := middleware.IssueAuditTicket()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"ticket":    ticket,
			"expire_at": exp,
		},
	})
}

// GetAuditPanelConfig 返回面板当前配置与运行状态。
// 未携带有效票据时只返回 password_set/enabled，避免泄露白名单等内部信息。
func GetAuditPanelConfig(c *gin.Context) {
	data := gin.H{
		"enabled":      operation_setting.ContentAuditEnabled,
		"password_set": operation_setting.ContentAuditPasswordConfigured(),
	}
	if middleware.ValidateAuditTicket(c.GetHeader("X-Audit-Ticket")) {
		data["mode"] = operation_setting.ContentAuditMode
		data["user_ids"] = operation_setting.ContentAuditUserIdsCsv
		data["groups"] = operation_setting.ContentAuditGroupsCsv
		data["max_body_bytes"] = operation_setting.ContentAuditMaxBodyBytes
		data["keep_days"] = operation_setting.ContentAuditKeepDays
		data["session_gap_minutes"] = operation_setting.ContentAuditSessionGapMinutes
		data["max_table_mb"] = operation_setting.ContentAuditMaxTableMB
		data["table_size_mb"] = model.GetAuditTableSizeMB()
		data["over_capacity"] = operation_setting.IsContentAuditOverCapacity()
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// UpdateAuditPanelConfig 更新面板设置（含修改密码）。
func UpdateAuditPanelConfig(c *gin.Context) {
	var req struct {
		Enabled           *bool   `json:"enabled"`
		Mode              *string `json:"mode"`
		UserIds           *string `json:"user_ids"`
		Groups            *string `json:"groups"`
		MaxBodyBytes      *int    `json:"max_body_bytes"`
		KeepDays          *int    `json:"keep_days"`
		SessionGapMinutes *int    `json:"session_gap_minutes"`
		MaxTableMB        *int    `json:"max_table_mb"`
		NewPassword       *string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	updates := make(map[string]string)
	if req.Enabled != nil {
		updates["ContentAuditEnabled"] = strconv.FormatBool(*req.Enabled)
	}
	if req.Mode != nil {
		mode := strings.ToLower(strings.TrimSpace(*req.Mode))
		if mode != operation_setting.ContentAuditModeAll {
			mode = operation_setting.ContentAuditModeWhitelist
		}
		updates["ContentAuditMode"] = mode
	}
	if req.UserIds != nil {
		updates["ContentAuditUserIds"] = strings.TrimSpace(*req.UserIds)
	}
	if req.Groups != nil {
		updates["ContentAuditGroups"] = strings.TrimSpace(*req.Groups)
	}
	if req.MaxBodyBytes != nil && *req.MaxBodyBytes > 0 {
		updates["ContentAuditMaxBodyBytes"] = strconv.Itoa(*req.MaxBodyBytes)
	}
	if req.KeepDays != nil && *req.KeepDays > 0 {
		updates["ContentAuditKeepDays"] = strconv.Itoa(*req.KeepDays)
	}
	if req.SessionGapMinutes != nil && *req.SessionGapMinutes > 0 {
		updates["ContentAuditSessionGapMinutes"] = strconv.Itoa(*req.SessionGapMinutes)
	}
	if req.MaxTableMB != nil && *req.MaxTableMB > 0 {
		updates["ContentAuditMaxTableMB"] = strconv.Itoa(*req.MaxTableMB)
	}
	if req.NewPassword != nil && strings.TrimSpace(*req.NewPassword) != "" {
		if len(*req.NewPassword) < 6 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码长度至少 6 位"})
			return
		}
		hash, err := common.Password2Hash(*req.NewPassword)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码加密失败"})
			return
		}
		updates["ContentAuditPanelPasswordHash"] = hash
	}
	for k, v := range updates {
		if err := model.UpdateOption(k, v); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": k + " 更新失败: " + err.Error()})
			return
		}
	}
	if req.KeepDays != nil {
		model.CleanupBodyLogsIfNeeded(true)
	}
	if req.MaxTableMB != nil {
		model.CheckAuditCapacity(true)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已保存"})
}

// GetAuditUsers 有审计记录的用户列表。
func GetAuditUsers(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	users, err := model.GetAuditUsers(limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users})
}

// GetAuditSessions 某用户的会话列表。
func GetAuditSessions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Query("user_id"))
	if userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "缺少 user_id"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	sessions, err := model.GetAuditSessions(userId, limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": sessions})
}

// GetAuditSessionDetail 某会话内的全部请求与回复（按时间正序）。
func GetAuditSessionDetail(c *gin.Context) {
	sessionId := strings.TrimSpace(c.Query("session_id"))
	if sessionId == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "缺少 session_id"})
		return
	}
	maxReqs, _ := strconv.Atoi(c.Query("limit"))
	logs, err := model.GetAuditSessionLogs(sessionId, maxReqs)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

// GetContentAuditLogs 分页列出审计记录（body 截断为预览）。
func GetContentAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("p"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 50 {
		pageSize = 20
	}
	userId, _ := strconv.Atoi(c.Query("user_id"))
	const previewLen = 4096
	logs, total, err := model.GetBodyLogs(userId, (page-1)*pageSize, pageSize, previewLen)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     logs,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetContentAuditLogDetail 单条审计记录全文。
func GetContentAuditLogDetail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的记录 ID"})
		return
	}
	log, err := model.GetBodyLogById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if log == nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "记录不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": log})
}
