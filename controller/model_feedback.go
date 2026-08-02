package controller

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type modelFeedbackRequest struct {
	ModelName  string `json:"model_name"`
	ReasonCode string `json:"reason_code"`
	ReasonText string `json:"reason_text"`
}

// 允许的反馈类型：掺水/不可用/疑似掺水/其他
var validFeedbackCodes = map[string]bool{
	"fake":        true, // 假模型/挂羊头卖狗肉
	"unavailable": true, // 不可用
	"watered":     true, // 疑似掺水
	"other":       true, // 其他
}

// SubmitModelFeedback 普通用户提交模型问题反馈
func SubmitModelFeedback(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}

	var req modelFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	req.ModelName = strings.TrimSpace(req.ModelName)
	if req.ModelName == "" || utf8.RuneCountInString(req.ModelName) > 128 {
		common.ApiErrorMsg(c, "模型名称无效")
		return
	}
	if !validFeedbackCodes[req.ReasonCode] {
		common.ApiErrorMsg(c, "反馈类型无效")
		return
	}

	// 清理补充说明中的控制字符，限制长度
	text := strings.Map(func(r rune) rune {
		if r == 0 || unicode.IsControl(r) && r != '\n' {
			return -1
		}
		return r
	}, req.ReasonText)
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > 500 {
		common.ApiErrorMsg(c, "补充说明不能超过 500 字")
		return
	}

	// 限频：同一用户 1 分钟内最多 5 条，防止刷接口
	since := common.GetTimestamp() - 60
	if cnt, err := model.CountRecentModelFeedbackByUser(userId, since); err == nil && cnt >= 5 {
		common.ApiErrorMsg(c, "反馈过于频繁，请稍后再试")
		return
	}

	feedback := &model.ModelFeedback{
		UserId:     userId,
		ModelName:  req.ModelName,
		ReasonCode: req.ReasonCode,
		ReasonText: text,
	}
	if err := feedback.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{"message": "反馈已提交，感谢你的反馈"})
}

// GetModelFeedbacks 管理员查看模型反馈列表（支持按状态筛选）
func GetModelFeedbacks(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	statusFilter := c.Query("status") // "" / "0" / "1"

	query := model.DB.Model(&model.ModelFeedback{})
	if statusFilter == "0" || statusFilter == "1" {
		query = query.Where("status = ?", statusFilter)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var items []model.ModelFeedback
	if err := query.Order("created_at DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Find(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// HandleModelFeedback 管理员标记反馈为已处理
func HandleModelFeedback(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		common.ApiErrorMsg(c, "缺少反馈 ID")
		return
	}
	operatorId := c.GetInt("id")
	err := model.DB.Model(&model.ModelFeedback{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":     1,
			"handled_by": operatorId,
			"handled_at": common.GetTimestamp(),
		}).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"message": "已标记为处理"})
}
