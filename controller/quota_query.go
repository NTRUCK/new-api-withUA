package controller

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type quotaQueryRequest struct {
	QueryType string `json:"query_type"`
	Value     string `json:"value"`
}

func GetQuotaQueryStatus(c *gin.Context) {
	data, err := model.GetQuotaQueryStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func QueryUserQuota(c *gin.Context) {
	var req quotaQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}
	userId := c.GetInt("id")
	result, err := model.QueryUserQuota(userId, req.QueryType, req.Value)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("付费查询用户额度，扣除额度：%s", logger.LogQuota(result.Fee)))
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
