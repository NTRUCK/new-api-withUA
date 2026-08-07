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

func ClaimDiceWelfare(c *gin.Context) {
	userId := c.GetInt("id")
	result, err := model.ClaimDiceWelfare(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("领取骰子低保：%s", logger.LogQuota(result.Granted)))
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
