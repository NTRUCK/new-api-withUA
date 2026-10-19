package model

import (
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// truncateRunes 按 rune 截断字符串（用作列表页大字段预览）。
func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 || len(s) <= maxRunes {
		return s
	}
	r := []rune(s)
	return string(r[:maxRunes])
}

// BodyLog 内容审计记录：命中白名单（用户/分组）的请求完整请求体与响应体原文。
// 与业务 logs 表分离，避免大字段拖累主日志查询。
type BodyLog struct {
	Id           int    `json:"id"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index:idx_body_logs_user_time,priority:2"`
	UserId       int    `json:"user_id" gorm:"index:idx_body_logs_user_time,priority:1"`
	Username     string `json:"username" gorm:"type:varchar(64)"`
	TokenId      int    `json:"token_id"`
	TokenName    string `json:"token_name" gorm:"type:varchar(128)"`
	GroupName    string `json:"group_name" gorm:"type:varchar(64)"`
	ModelName    string `json:"model_name" gorm:"type:varchar(255)"`
	ChannelId    int    `json:"channel_id"`
	RequestBody  string `json:"request_body" gorm:"type:text"`
	ResponseBody string `json:"response_body" gorm:"type:text"`
	StatusCode   int    `json:"status_code"`
	ErrorPreview string `json:"error_preview" gorm:"type:varchar(512)"`
}

func bodyLogDB() *gorm.DB {
	db := LOG_DB
	if db == nil {
		db = DB
	}
	return db
}

// InitBodyLogTable 幂等迁移审计表；失败不阻塞主流程（由 main.go 降级告警）。
func InitBodyLogTable() error {
	db := bodyLogDB()
	if db == nil {
		return nil
	}
	if err := db.AutoMigrate(&BodyLog{}); err != nil {
		return err
	}
	CleanupBodyLogsIfNeeded(true)
	return nil
}

// InsertBodyLog 写入一条审计记录（调用侧已在 goroutine 中，不阻塞 relay）。
func InsertBodyLog(log *BodyLog) error {
	db := bodyLogDB()
	if db == nil {
		return nil
	}
	return db.Create(log).Error
}

var bodyLogCleanupMu sync.Mutex
var bodyLogCleanupLast time.Time

// CleanupBodyLogsIfNeeded 按 ContentAuditKeepDays 清理过期记录。
// force 时立即执行，否则两次清理至少间隔 1 小时（惰性触发，避免额外定时器）。
func CleanupBodyLogsIfNeeded(force bool) {
	keepDays := operation_setting.ContentAuditKeepDays
	if keepDays <= 0 {
		return
	}
	bodyLogCleanupMu.Lock()
	defer bodyLogCleanupMu.Unlock()
	if !force && time.Since(bodyLogCleanupLast) < time.Hour {
		return
	}
	bodyLogCleanupLast = time.Now()
	db := bodyLogDB()
	if db == nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -keepDays).Unix()
	_ = db.Where("created_at < ?", cutoff).Delete(&BodyLog{}).Error
}

// GetBodyLogs 分页查询审计记录；bodyPreviewLen>0 时仅返回预览长度（0 表示全量）。
func GetBodyLogs(userId int, offset int, limit int, bodyPreviewLen int) ([]BodyLog, int64, error) {
	db := bodyLogDB()
	if db == nil {
		return nil, 0, nil
	}
	query := db.Model(&BodyLog{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []BodyLog
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	if bodyPreviewLen > 0 {
		for i := range logs {
			logs[i].RequestBody = truncateRunes(logs[i].RequestBody, bodyPreviewLen)
			logs[i].ResponseBody = truncateRunes(logs[i].ResponseBody, bodyPreviewLen)
		}
	}
	return logs, total, nil
}

// GetBodyLogById 查询单条审计记录全文（管理端详情）。
func GetBodyLogById(id int) (*BodyLog, error) {
	db := bodyLogDB()
	if db == nil {
		return nil, nil
	}
	var log BodyLog
	if err := db.First(&log, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &log, nil
}
