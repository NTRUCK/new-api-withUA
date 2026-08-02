package model

import (
	"github.com/QuantumNous/new-api/common"
)

// ModelFeedback 用户对模型广场中模型的问题反馈
type ModelFeedback struct {
	Id         int    `json:"id"`
	UserId     int    `json:"user_id" gorm:"column:user_id;index"`
	ModelName  string `json:"model_name" gorm:"column:model_name;type:varchar(128);index"`
	ReasonCode string `json:"reason_code" gorm:"column:reason_code;type:varchar(32)"` // fake / unavailable / watered / other
	ReasonText string `json:"reason_text" gorm:"column:reason_text;type:varchar(500)"`
	Status     int    `json:"status" gorm:"column:status;default:0;index"` // 0=待处理 1=已处理
	CreatedAt  int64  `json:"created_at" gorm:"column:created_at;index"`
	HandledBy  int    `json:"handled_by" gorm:"column:handled_by"`
	HandledAt  int64  `json:"handled_at" gorm:"column:handled_at"`
}

func (f *ModelFeedback) Insert() error {
	f.CreatedAt = common.GetTimestamp()
	return DB.Create(f).Error
}

// CountRecentModelFeedbackByUser 统计用户在指定时间戳之后提交的反馈数，用于限频
func CountRecentModelFeedbackByUser(userId int, since int64) (int64, error) {
	var count int64
	err := DB.Model(&ModelFeedback{}).
		Where("user_id = ? AND created_at >= ?", userId, since).
		Count(&count).Error
	return count, err
}
