package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// getAuditUserId 解析 user_id 查询参数（可选）。
func getAuditUserId(c *gin.Context) int {
	v, _ := strconv.Atoi(c.Query("user_id"))
	return v
}

// GetContentAuditLogs 分页列出内容审计记录（body 截断为预览）。
func GetContentAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("p"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 50 {
		pageSize = 20
	}
	const previewLen = 4096
	logs, total, err := model.GetBodyLogs(getAuditUserId(c), (page-1)*pageSize, pageSize, previewLen)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
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
