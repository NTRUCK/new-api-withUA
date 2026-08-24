package common

import "sync"

// RetryOn524Enabled 控制当上游返回 524（Cloudflare 源站超时）时是否自动重试。
// 524 默认被硬编码为"永不重试"（见 setting/operation_setting/status_code_ranges.go），
// 该开关开启后，524 将被放行进入正常的 RetryTimes 重试链（每次重试会自动切换多 key 渠道的下一个 key）。
var RetryOn524Enabled = false

// Retry524Stat 记录单个渠道的 524 相关统计，用于评估额度供给。
type Retry524Stat struct {
	// TriggerCount 524 触发次数（等于日志中该渠道 RetryOn524 出现的次数），反映 524 报错频率。
	TriggerCount int64 `json:"trigger_count"`
	// RetryCount 因 524 真正向上游重发的次数（524 后仍有重试余额、确实又发起了一次上游请求）。
	// 这才是因 524 而额外多消耗的按次计费调用数。
	RetryCount int64 `json:"retry_count"`
	// UpstreamCount 该渠道向上游发起的总请求次数（不论成败），用作计算 524 占比的分母。
	UpstreamCount int64 `json:"upstream_count"`
}

// retry524Stats 按渠道 ID 聚合的 524 统计。使用读写锁保证并发安全；
// 持久化到 option 表（key=RetryOn524Stats，JSON 序列化），重启不丢。
var (
	retry524Mu    sync.RWMutex
	retry524Stats = map[int]*Retry524Stat{}
)

// getOrCreateStatLocked 需在持有写锁时调用。
func getOrCreateStatLocked(channelId int) *Retry524Stat {
	s := retry524Stats[channelId]
	if s == nil {
		s = &Retry524Stat{}
		retry524Stats[channelId] = s
	}
	return s
}

// IncrUpstreamRequest 累计指定渠道向上游发起的总请求次数。
func IncrUpstreamRequest(channelId int) {
	retry524Mu.Lock()
	getOrCreateStatLocked(channelId).UpstreamCount++
	retry524Mu.Unlock()
}

// IncrRetry524Trigger 累计指定渠道的 524 触发次数（无论后续是否重试）。
func IncrRetry524Trigger(channelId int) {
	retry524Mu.Lock()
	getOrCreateStatLocked(channelId).TriggerCount++
	retry524Mu.Unlock()
}

// IncrRetry524Retry 累计指定渠道因 524 真正向上游重发的次数。
func IncrRetry524Retry(channelId int) {
	retry524Mu.Lock()
	getOrCreateStatLocked(channelId).RetryCount++
	retry524Mu.Unlock()
}

// MarshalRetry524Stats 将当前统计序列化为 JSON 字符串，用于持久化与前端展示。
func MarshalRetry524Stats() string {
	retry524Mu.RLock()
	defer retry524Mu.RUnlock()
	b, err := Marshal(retry524Stats)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// MergeRetry524Stats 从数据库加载/周期性同步时回填统计，逐字段取较大值（只增不减），
// 避免 SyncOptions 用旧值覆盖内存中更新的计数。
func MergeRetry524Stats(jsonStr string) {
	if jsonStr == "" {
		return
	}
	incoming := map[int]*Retry524Stat{}
	if err := UnmarshalJsonStr(jsonStr, &incoming); err != nil {
		return
	}
	retry524Mu.Lock()
	defer retry524Mu.Unlock()
	for id, in := range incoming {
		if in == nil {
			continue
		}
		cur := getOrCreateStatLocked(id)
		if in.TriggerCount > cur.TriggerCount {
			cur.TriggerCount = in.TriggerCount
		}
		if in.RetryCount > cur.RetryCount {
			cur.RetryCount = in.RetryCount
		}
		if in.UpstreamCount > cur.UpstreamCount {
			cur.UpstreamCount = in.UpstreamCount
		}
	}
}
