package service

import (
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

// kiroCreditBucket 渠道的 Kiro 模拟 credits 内存计数：月度累计 + 定期与日志表对账。
type kiroCreditBucket struct {
	mu       sync.Mutex
	month    string    // 归属月份 "2006-01"
	credits  float64   // 当月累计 credits（含内存未对账部分）
	lastSync time.Time // 最近一次与日志表对账时间
}

var kiroCreditBuckets sync.Map // channelId(int) -> *kiroCreditBucket

const kiroCreditResyncInterval = 90 * time.Second

func kiroMonthKey(t time.Time) string {
	return t.Format("2006-01")
}

func kiroMonthStartUnix() int64 {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
}

// syncKiroCreditFromLog 从日志表 SUM 当月该渠道的 kiro_credits（跨库取 JSON 字段）。
func syncKiroCreditFromLog(channelId int) float64 {
	if model.DB == nil {
		return 0
	}
	var expr string
	if common.UsingPostgreSQL {
		expr = "COALESCE(SUM((other::jsonb->>'kiro_credits')::float8), 0)"
	} else {
		// MySQL 与 SQLite 均支持 json_extract；空值/无字段时 CAST 结果为 0
		expr = "COALESCE(SUM(CAST(json_extract(other, '$.kiro_credits') AS REAL)), 0)"
	}
	var sum float64
	if err := model.DB.Table("logs").
		Select(expr).
		Where("channel_id = ? AND type = ? AND created_at >= ?",
			channelId, model.LogTypeConsume, kiroMonthStartUnix()).
		Scan(&sum).Error; err != nil {
		common.SysError("kiro credit sim: failed to sum credits for channel " +
			strconv.Itoa(channelId) + ": " + err.Error())
		return 0
	}
	return sum
}

// loadKiroCreditBucket 取渠道 bucket；必要时从日志表对账（月切换或超过重对账间隔）。
func loadKiroCreditBucket(channelId int, force bool) *kiroCreditBucket {
	v, _ := kiroCreditBuckets.LoadOrStore(channelId, &kiroCreditBucket{})
	b := v.(*kiroCreditBucket)
	b.mu.Lock()
	defer b.mu.Unlock()
	cur := kiroMonthKey(time.Now())
	stale := time.Since(b.lastSync) > kiroCreditResyncInterval
	if force || b.month != cur || (b.lastSync.IsZero() && b.credits == 0) || stale {
		b.credits = syncKiroCreditFromLog(channelId)
		b.month = cur
		b.lastSync = time.Now()
	}
	return b
}

// CheckKiroCreditLimit 检查渠道当月模拟 credits 是否已超限。
// 判定口径：当月日志累计 + 期初已用（KiroCreditUsedInitial）。
// 返回 (当前已用 credits, 是否放行)。
func CheckKiroCreditLimit(setting dto.ChannelSettings, channelId int) (float64, bool) {
	if !setting.KiroCreditSim || setting.KiroCreditLimit <= 0 {
		return 0, true
	}
	b := loadKiroCreditBucket(channelId, false)
	b.mu.Lock()
	used := b.credits
	b.mu.Unlock()
	used += float64(setting.KiroCreditUsedInitial)
	return used, used < float64(setting.KiroCreditLimit)
}

// AddKiroCreditUsage 渠道消费日志落库后，将本次估算 credits 累加进内存计数。
// bucket 不存在时先从日志表对账初始化，保证重启后计数不丢。
func AddKiroCreditUsage(channelId int, credits float64) {
	v, ok := kiroCreditBuckets.Load(channelId)
	if !ok {
		loadKiroCreditBucket(channelId, true)
		v, ok = kiroCreditBuckets.Load(channelId)
		if !ok {
			return
		}
	}
	b := v.(*kiroCreditBucket)
	b.mu.Lock()
	defer b.mu.Unlock()
	cur := kiroMonthKey(time.Now())
	if b.month != cur {
		b.month = cur
		b.credits = 0
	}
	b.credits += credits
	b.lastSync = time.Now()
}

// KiroDayStat 按日 credits 聚合（自然月内，服务器时区口径）。
type KiroDayStat struct {
	Date    string  `json:"date"`
	Reqs    int64   `json:"reqs"`
	Credits float64 `json:"credits"`
}

// KiroLogItem 渠道消费日志明细（others 中含 kiro_credits 的消费记录）。
type KiroLogItem struct {
	CreatedAt        int64   `json:"created_at"`
	ModelName        string  `json:"model_name"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	Credits          float64 `json:"credits"`
	Mult             float64 `json:"mult"`
}

// GetKiroCreditStats 返回渠道当月（自然月）credits 总量与按日聚合。
func GetKiroCreditStats(channelId int) (float64, []KiroDayStat, error) {
	if model.DB == nil {
		return 0, nil, nil
	}
	total := syncKiroCreditFromLog(channelId)
	var dayExpr, creditsExpr string
	if common.UsingPostgreSQL {
		dayExpr = "to_char(to_timestamp(created_at) AT TIME ZONE 'Asia/Shanghai','MM-DD')"
		creditsExpr = "COALESCE(SUM((other::jsonb->>'kiro_credits')::float8), 0)"
	} else {
		if common.UsingSQLite {
			dayExpr = "strftime('%m-%d', created_at, 'unixepoch', 'localtime')"
		} else {
			dayExpr = "DATE_FORMAT(FROM_UNIXTIME(created_at), '%m-%d')"
		}
		creditsExpr = "COALESCE(SUM(CAST(json_extract(other, '$.kiro_credits') AS REAL)), 0)"
	}
	var daily []KiroDayStat
	err := model.DB.Table("logs").
		Select(dayExpr+" AS date, COUNT(*) AS reqs, "+creditsExpr+" AS credits").
		Where("channel_id = ? AND type = ? AND created_at >= ?",
			channelId, model.LogTypeConsume, kiroMonthStartUnix()).
		Group("date").
		Order("date ASC").
		Scan(&daily).Error
	if err != nil {
		return total, nil, err
	}
	return total, daily, nil
}

// GetKiroCreditRecentLogs 返回渠道最近 consumption 日志的 credits 估算明细。
func GetKiroCreditRecentLogs(channelId int, limit int) ([]KiroLogItem, error) {
	if model.DB == nil {
		return nil, nil
	}
	var rows []struct {
		CreatedAt        int64
		ModelName        string
		PromptTokens     int
		CompletionTokens int
		Other            string
	}
	err := model.DB.Table("logs").
		Select("created_at, model_name, prompt_tokens, completion_tokens, other").
		Where("channel_id = ? AND type = ?", channelId, model.LogTypeConsume).
		Order("created_at DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	items := make([]KiroLogItem, 0, len(rows))
	for _, r := range rows {
		item := KiroLogItem{
			CreatedAt:        r.CreatedAt,
			ModelName:        r.ModelName,
			PromptTokens:     r.PromptTokens,
			CompletionTokens: r.CompletionTokens,
		}
		if r.Other != "" {
			var other map[string]interface{}
			if err := common.Unmarshal([]byte(r.Other), &other); err == nil {
				if v, ok := other["kiro_credits"].(float64); ok {
					item.Credits = v
				}
				if v, ok := other["kiro_mult"].(float64); ok {
					item.Mult = v
				}
			}
		}
		items = append(items, item)
	}
	return items, nil
}
