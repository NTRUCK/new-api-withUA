package model

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// BodyLog 内容审计记录：一次请求的完整请求体与 AI 回复（压缩存储），
// 按 token + UA + 时间间隔归并为会话（SessionId），便于连贯回看上下文。
// 与业务 logs 表分离，避免大字段拖累主日志查询。
type BodyLog struct {
	Id               int    `json:"id"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index:idx_body_logs_user_time,priority:2;index:idx_body_logs_session,priority:2"`
	UserId           int    `json:"user_id" gorm:"index:idx_body_logs_user_time,priority:1"`
	Username         string `json:"username" gorm:"type:varchar(64)"`
	TokenId          int    `json:"token_id" gorm:"index:idx_body_logs_session,priority:1"`
	TokenName        string `json:"token_name" gorm:"type:varchar(128)"`
	GroupName        string `json:"group_name" gorm:"type:varchar(64)"`
	ModelName        string `json:"model_name" gorm:"type:varchar(255)"`
	ChannelId        int    `json:"channel_id"`
	SessionId        string `json:"session_id" gorm:"type:varchar(40);index"`
	UserAgent        string `json:"user_agent" gorm:"type:varchar(512)"`
	ClientIp         string `json:"client_ip" gorm:"type:varchar(64)"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	DurationMs       int    `json:"duration_ms"`
	// RequestBody / ResponseBody 为 base64(gzip(明文))，压缩失败时 Compressed=false 存明文
	RequestBody  string `json:"request_body" gorm:"type:text"`
	ResponseBody string `json:"response_body" gorm:"type:text"`
	Compressed   bool   `json:"compressed"`
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

// ===== 压缩 =====

func gzipBase64(s string) (string, bool) {
	if s == "" {
		return "", true
	}
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return s, false
	}
	if _, err = zw.Write([]byte(s)); err != nil {
		return s, false
	}
	if err = zw.Close(); err != nil {
		return s, false
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), true
}

func ungzipBase64(s string, compressed bool) string {
	if s == "" || !compressed {
		return s
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return s
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return s
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, 64*1024*1024))
	if err != nil {
		return s
	}
	return string(out)
}

// truncateRunes 按 rune 截断字符串（用作列表页大字段预览）。
func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 || len(s) <= maxRunes {
		return s
	}
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes])
}

// ===== 会话归属 =====

type auditSessionKey struct {
	tokenId int
	uaHash  string
}

type auditSessionEntry struct {
	id   string
	last int64
}

var (
	auditSessionMu  sync.Mutex
	auditSessionMap = make(map[auditSessionKey]*auditSessionEntry)
	auditSessionSeq atomic.Uint64
)

func newAuditSessionId() string {
	return fmt.Sprintf("s%d%06x", time.Now().UnixNano()/1e6, auditSessionSeq.Add(1)&0xffffff)
}

func uaHash(ua string) string {
	sum := sha256.Sum256([]byte(ua))
	return hex.EncodeToString(sum[:8])
}

// pruneAuditSessionsLocked 控制内存会话表规模：条目过多时清理已过期会话。
// 调用方需持有 auditSessionMu。
func pruneAuditSessionsLocked(now int64, gap int64) {
	const maxEntries = 8192
	if len(auditSessionMap) <= maxEntries {
		return
	}
	for k, e := range auditSessionMap {
		if now-e.last > gap {
			delete(auditSessionMap, k)
		}
	}
}

// resolveAuditSession 按 token + UA + 会话间隔推导归属会话。
func resolveAuditSession(tokenId int, ua string, now int64) string {
	key := auditSessionKey{tokenId: tokenId, uaHash: uaHash(ua)}
	gap := operation_setting.GetContentAuditSessionGap()

	auditSessionMu.Lock()
	if e, ok := auditSessionMap[key]; ok && now-e.last <= gap {
		e.last = now
		id := e.id
		auditSessionMu.Unlock()
		return id
	}
	auditSessionMu.Unlock()

	// 内存未命中：回查最近一条记录（重启或多实例场景）
	db := bodyLogDB()
	if db != nil {
		var last BodyLog
		if err := db.Select("id, session_id").
			Where("token_id = ? AND user_agent = ? AND created_at >= ?", tokenId, ua, now-gap).
			Order("id DESC").Limit(1).Find(&last).Error; err == nil && last.Id > 0 && last.SessionId != "" {
			auditSessionMu.Lock()
			// 回查期间可能有并发请求已建立会话，优先复用
			if e, ok := auditSessionMap[key]; ok && now-e.last <= gap {
				id := e.id
				e.last = now
				auditSessionMu.Unlock()
				return id
			}
			auditSessionMap[key] = &auditSessionEntry{id: last.SessionId, last: now}
			auditSessionMu.Unlock()
			return last.SessionId
		}
	}

	auditSessionMu.Lock()
	defer auditSessionMu.Unlock()
	// 并发首请求可能已在回查期间建立会话
	if e, ok := auditSessionMap[key]; ok && now-e.last <= gap {
		e.last = now
		return e.id
	}
	id := newAuditSessionId()
	pruneAuditSessionsLocked(now, gap)
	auditSessionMap[key] = &auditSessionEntry{id: id, last: now}
	return id
}

// ===== 写入 / 容量保护 =====

var auditCapacityCheckAt atomic.Int64

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
// 会话归属在此处推导，body 压缩后落库。
func InsertBodyLog(log *BodyLog) error {
	if operation_setting.IsContentAuditOverCapacity() {
		return nil
	}
	db := bodyLogDB()
	if db == nil {
		return nil
	}
	if log.CreatedAt == 0 {
		log.CreatedAt = common.GetTimestamp()
	}
	if log.SessionId == "" {
		log.SessionId = resolveAuditSession(log.TokenId, log.UserAgent, log.CreatedAt)
	}
	req, ok1 := gzipBase64(log.RequestBody)
	resp, ok2 := gzipBase64(log.ResponseBody)
	if ok1 && ok2 {
		// 仅在两侧都压缩成功时统一标记，避免查询侧对单边解压错乱
		log.RequestBody = req
		log.ResponseBody = resp
		log.Compressed = true
	}
	return db.Create(log).Error
}

// auditTableBytes 返回审计表占用字节数（跨库）。
func auditTableBytes() int64 {
	db := bodyLogDB()
	if db == nil {
		return 0
	}
	var size int64
	switch {
	case common.UsingPostgreSQL:
		_ = db.Raw("SELECT COALESCE(pg_total_relation_size('body_logs'), 0)").Scan(&size).Error
	case common.UsingSQLite:
		// SQLite 无单表大小，使用整库页数估算；容量保护退化为整库阈值
		_ = db.Raw("SELECT COALESCE(page_count * page_size, 0) FROM pragma_page_count(), pragma_page_size()").Scan(&size).Error
	default:
		_ = db.Raw("SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables " +
			"WHERE table_schema = DATABASE() AND table_name = 'body_logs'").Scan(&size).Error
	}
	return size
}

// CheckAuditCapacity 每 5 分钟检查一次表容量，超过阈值则停止记录并告警。
func CheckAuditCapacity(force bool) {
	if operation_setting.ContentAuditMaxTableMB <= 0 {
		return
	}
	now := time.Now().Unix()
	last := auditCapacityCheckAt.Load()
	if !force && now-last < 300 {
		return
	}
	if !auditCapacityCheckAt.CompareAndSwap(last, now) {
		return
	}
	limit := int64(operation_setting.ContentAuditMaxTableMB) * 1024 * 1024
	size := auditTableBytes()
	if size > limit {
		if !operation_setting.IsContentAuditOverCapacity() {
			operation_setting.SetContentAuditOverCapacity(true)
			common.SysError(fmt.Sprintf(
				"content audit stopped: body_logs size %d MB exceeds limit %d MB",
				size/1024/1024, operation_setting.ContentAuditMaxTableMB))
		}
		return
	}
	// 清理后回落则恢复记录
	if operation_setting.IsContentAuditOverCapacity() {
		operation_setting.SetContentAuditOverCapacity(false)
		common.SysLog("content audit resumed: body_logs size back under limit")
	}
}

// GetAuditTableSizeMB 面板展示当前占用（MB，向上取整）。
func GetAuditTableSizeMB() int64 {
	size := auditTableBytes()
	if size <= 0 {
		return 0
	}
	return (size + 1024*1024 - 1) / 1024 / 1024
}

// ===== 清理 =====

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

// ===== 查询 =====

// AuditUserStat 按用户聚合的审计概览。
type AuditUserStat struct {
	UserId           int    `json:"user_id"`
	Username         string `json:"username"`
	Reqs             int64  `json:"reqs"`
	LastAt           int64  `json:"last_at"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
}

// GetAuditUsers 返回有审计记录的用户列表（按最近活跃排序）。
func GetAuditUsers(limit int) ([]AuditUserStat, error) {
	db := bodyLogDB()
	if db == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var rows []AuditUserStat
	err := db.Table("body_logs").
		Select("user_id, MAX(username) AS username, COUNT(*) AS reqs, MAX(created_at) AS last_at, " +
			"COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(completion_tokens),0) AS completion_tokens").
		Group("user_id").
		Order("last_at DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// AuditSessionStat 按会话聚合的概览。
type AuditSessionStat struct {
	SessionId   string `json:"session_id"`
	TokenId     int    `json:"token_id"`
	TokenName   string `json:"token_name"`
	UserAgent   string `json:"user_agent"`
	ModelName   string `json:"model_name"`
	StartAt     int64  `json:"start_at"`
	EndAt       int64  `json:"end_at"`
	Reqs        int64  `json:"reqs"`
	TotalTokens int64  `json:"total_tokens"`
}

// GetAuditSessions 返回某用户的会话列表（按最近活跃排序）。
func GetAuditSessions(userId int, limit int) ([]AuditSessionStat, error) {
	db := bodyLogDB()
	if db == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var rows []AuditSessionStat
	err := db.Table("body_logs").
		Select("session_id, MAX(token_id) AS token_id, MAX(token_name) AS token_name, "+
			"MAX(user_agent) AS user_agent, MAX(model_name) AS model_name, "+
			"MIN(created_at) AS start_at, MAX(created_at) AS end_at, COUNT(*) AS reqs, "+
			"COALESCE(SUM(prompt_tokens + completion_tokens),0) AS total_tokens").
		Where("user_id = ? AND session_id <> ''", userId).
		Group("session_id").
		Order("end_at DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// GetAuditSessionLogs 返回某会话内的全部记录（按时间正序），body 已解压。
func GetAuditSessionLogs(sessionId string, maxReqs int) ([]BodyLog, error) {
	db := bodyLogDB()
	if db == nil {
		return nil, nil
	}
	if maxReqs <= 0 || maxReqs > 500 {
		maxReqs = 200
	}
	var logs []BodyLog
	if err := db.Where("session_id = ?", sessionId).
		Order("created_at ASC, id ASC").Limit(maxReqs).Find(&logs).Error; err != nil {
		return nil, err
	}
	for i := range logs {
		logs[i].RequestBody = ungzipBase64(logs[i].RequestBody, logs[i].Compressed)
		logs[i].ResponseBody = ungzipBase64(logs[i].ResponseBody, logs[i].Compressed)
	}
	return logs, nil
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
	log.RequestBody = ungzipBase64(log.RequestBody, log.Compressed)
	log.ResponseBody = ungzipBase64(log.ResponseBody, log.Compressed)
	return &log, nil
}

// GetBodyLogs 分页查询审计记录（兼容旧接口，body 返回截断预览）。
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
			logs[i].RequestBody = truncateRunes(ungzipBase64(logs[i].RequestBody, logs[i].Compressed), bodyPreviewLen)
			logs[i].ResponseBody = truncateRunes(ungzipBase64(logs[i].ResponseBody, logs[i].Compressed), bodyPreviewLen)
			logs[i].Compressed = false
		}
	}
	return logs, total, nil
}
