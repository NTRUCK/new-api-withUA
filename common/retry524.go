package common

import "sync/atomic"

// RetryOn524Enabled 控制当上游返回 524（Cloudflare 源站超时）时是否自动重试。
// 524 默认被硬编码为"永不重试"（见 setting/operation_setting/status_code_ranges.go），
// 该开关开启后，524 将被放行进入正常的 RetryTimes 重试链（每次重试会自动切换多 key 渠道的下一个 key）。
var RetryOn524Enabled = false

// retryOn524Count 累计因 524 而触发的额外重试次数，用于统计额外消耗的上游调用次数。
// 使用原子操作保证并发安全；持久化到 option 表（key=RetryOn524Count），重启不丢。
var retryOn524Count int64

// IncrRetryOn524Count 递增并返回最新的 524 额外重试计数。
func IncrRetryOn524Count() int64 {
	return atomic.AddInt64(&retryOn524Count, 1)
}

// GetRetryOn524Count 返回当前 524 额外重试计数。
func GetRetryOn524Count() int64 {
	return atomic.LoadInt64(&retryOn524Count)
}

// SetRetryOn524CountIfLarger 仅在传入值大于当前值时更新计数。
// 用于从数据库加载/周期性同步时回填，避免 SyncOptions 用旧值覆盖内存中更新的计数。
func SetRetryOn524CountIfLarger(v int64) {
	for {
		cur := atomic.LoadInt64(&retryOn524Count)
		if v <= cur {
			return
		}
		if atomic.CompareAndSwapInt64(&retryOn524Count, cur, v) {
			return
		}
	}
}
