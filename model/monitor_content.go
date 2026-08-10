package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const MonitorRequestBodyContextKey = "monitor_request_body"

type MonitorContent struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"index:idx_monitor_user_created"`
	Username     string `json:"username" gorm:"type:varchar(64);index"`
	TokenId      int    `json:"token_id" gorm:"index"`
	TokenName    string `json:"token_name" gorm:"type:varchar(255);index"`
	ModelName    string `json:"model_name" gorm:"type:varchar(255);index"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);index"`
	UserAgent    string `json:"user_agent" gorm:"type:text"`
	Ip           string `json:"ip" gorm:"type:varchar(64)"`
	IsStream     bool   `json:"is_stream"`
	RequestBody  string `json:"request_body" gorm:"type:text"`
	ResponseBody string `json:"response_body" gorm:"type:text"`
	CreatedAt    int64  `json:"created_at" gorm:"index:idx_monitor_user_created"`
}

func (MonitorContent) TableName() string {
	return "monitor_contents"
}

func SetMonitorRequestBody(c *gin.Context, body []byte) {
	if c == nil || len(body) == 0 {
		return
	}
	c.Set(MonitorRequestBodyContextKey, string(body))
}

func RecordMonitorContent(c *gin.Context, responseBody []byte) {
	if c == nil || len(responseBody) == 0 {
		return
	}
	requestBody, _ := c.Get(MonitorRequestBodyContextKey)
	requestBodyString, _ := requestBody.(string)
	if requestBodyString == "" {
		return
	}

	record := &MonitorContent{
		UserId:       c.GetInt("id"),
		Username:     c.GetString("username"),
		TokenId:      c.GetInt("token_id"),
		TokenName:    c.GetString("token_name"),
		ModelName:    c.GetString("original_model"),
		RequestId:    c.GetString(common.RequestIdKey),
		UserAgent:    c.Request.UserAgent(),
		Ip:           c.ClientIP(),
		IsStream:     c.GetBool("is_stream"),
		RequestBody:  requestBodyString,
		ResponseBody: string(responseBody),
		CreatedAt:    time.Now().Unix(),
	}
	if record.ModelName == "" {
		record.ModelName = c.GetString("model_name")
	}

	if err := DB.Create(record).Error; err != nil {
		common.SysError("record monitor content failed: " + err.Error())
		return
	}
	cleanupMonitorContent(record.UserId)
}

func cleanupMonitorContent(userId int) {
	if DB == nil || userId == 0 {
		return
	}
	cutoff := time.Now().Add(-72 * time.Hour).Unix()
	if err := DB.Where("created_at < ?", cutoff).Delete(&MonitorContent{}).Error; err != nil {
		common.SysError("cleanup old monitor content failed: " + err.Error())
	}

	var keepIds []int
	if err := DB.Model(&MonitorContent{}).
		Where("user_id = ?", userId).
		Order("created_at desc, id desc").
		Limit(20).
		Pluck("id", &keepIds).Error; err != nil {
		common.SysError("query monitor content keep ids failed: " + err.Error())
		return
	}
	if len(keepIds) < 20 {
		return
	}
	if err := DB.Where("user_id = ? AND id NOT IN ?", userId, keepIds).Delete(&MonitorContent{}).Error; err != nil {
		common.SysError("cleanup user monitor content failed: " + err.Error())
	}
}

func GetMonitorUsers() ([]MonitorContent, error) {
	var rows []MonitorContent
	// 每个用户取最近一条记录。使用窗口函数而非 GROUP BY，
	// 因为 PostgreSQL 不允许 SELECT 未聚合的列。
	err := DB.Raw(`
		SELECT id, user_id, username, token_id, token_name, model_name,
		       request_id, user_agent, ip, is_stream, created_at
		FROM (
			SELECT *, ROW_NUMBER() OVER (
				PARTITION BY user_id ORDER BY created_at DESC, id DESC
			) AS rn
			FROM monitor_contents
		) ranked
		WHERE rn = 1
		ORDER BY created_at DESC
	`).Scan(&rows).Error
	return rows, err
}

func GetMonitorContents(userId int, limit int) ([]MonitorContent, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var rows []MonitorContent
	err := DB.Where("user_id = ?", userId).
		Order("created_at desc, id desc").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}
