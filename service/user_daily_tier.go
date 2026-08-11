package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// 用户级每日请求次数计数服务
// 统计口径：仅成功调用；重置方式：按 UserDailyTierResetHour 配置的重置小时（服务器本地时区）
// 计数粒度：用户 ID + 分组，同一用户在各分组独立累计

const userDailyTierRedisPrefix = "userDailyTier"

// 内存计数回退实现
type memoryUserDailyCounter struct {
	mu     sync.Mutex
	period string           // 当前统计周期标识（YYYY-MM-DD@resetHour）
	count  map[string]int64 // userId:group -> 已用次数
}

var memUserDailyCounter = &memoryUserDailyCounter{
	count: make(map[string]int64),
}

// userDailyTierPeriod 返回当前所处的统计周期标识
// 以 resetHour 为周期起点：当前时间若早于今日 resetHour，则属于昨天起的周期
func userDailyTierPeriod() string {
	now := time.Now()
	resetHour := setting.UserDailyTierResetHour
	if resetHour < 0 || resetHour > 23 {
		resetHour = 0
	}
	y, m, d := now.Date()
	start := time.Date(y, m, d, resetHour, 0, 0, 0, now.Location())
	if now.Before(start) {
		start = start.AddDate(0, 0, -1)
	}
	return start.Format("2006-01-02@15")
}

// secondsUntilNextReset 距离下一个重置点的秒数（用于 Redis key 过期）
func userDailyTierSecondsUntilNextReset() int64 {
	now := time.Now()
	resetHour := setting.UserDailyTierResetHour
	if resetHour < 0 || resetHour > 23 {
		resetHour = 0
	}
	y, m, d := now.Date()
	next := time.Date(y, m, d, resetHour, 0, 0, 0, now.Location())
	if !now.Before(next) {
		next = next.AddDate(0, 0, 1)
	}
	return int64(next.Sub(now).Seconds())
}

func userDailyTierKey(userId int, group string) string {
	return fmt.Sprintf("%s:%s:%d:%s", userDailyTierRedisPrefix, userDailyTierPeriod(), userId, group)
}

func memoryUserDailyTierKey(userId int, group string) string {
	return fmt.Sprintf("%d:%s", userId, group)
}

// GetUserDailyRequestCount 返回用户在指定分组的当日已成功请求次数
func GetUserDailyRequestCount(userId int, group string) int64 {
	if common.RedisEnabled {
		ctx := context.Background()
		val, err := common.RDB.Get(ctx, userDailyTierKey(userId, group)).Int64()
		if err != nil {
			return 0
		}
		return val
	}
	memUserDailyCounter.mu.Lock()
	defer memUserDailyCounter.mu.Unlock()
	if memUserDailyCounter.period != userDailyTierPeriod() {
		return 0
	}
	return memUserDailyCounter.count[memoryUserDailyTierKey(userId, group)]
}

// IncrUserDailyRequestCount 在一次成功调用后将用户对应分组的当日计数加一
func IncrUserDailyRequestCount(userId int, group string) {
	if common.RedisEnabled {
		ctx := context.Background()
		key := userDailyTierKey(userId, group)
		pipe := common.RDB.TxPipeline()
		incr := pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, time.Duration(userDailyTierSecondsUntilNextReset())*time.Second)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError("failed to incr user daily request count: " + err.Error())
			return
		}
		_ = incr
		return
	}
	memUserDailyCounter.mu.Lock()
	defer memUserDailyCounter.mu.Unlock()
	period := userDailyTierPeriod()
	if memUserDailyCounter.period != period {
		memUserDailyCounter.period = period
		memUserDailyCounter.count = make(map[string]int64)
	}
	memUserDailyCounter.count[memoryUserDailyTierKey(userId, group)]++
}

// CheckUserDailyTierLimit 校验用户是否达到每日硬限额
// 返回 (allowed, used, hardLimit)；未启用或豁免时 allowed=true
func CheckUserDailyTierLimit(userId int, group string, isAdmin bool) (allowed bool, used int64, hardLimit int) {
	if !setting.UserDailyTierEnabled {
		return true, 0, 0
	}
	if isAdmin && setting.UserDailyTierAdminExempt {
		return true, 0, 0
	}
	used = GetUserDailyRequestCount(userId, group)
	hardLimit = setting.UserDailyTierHardLimit
	if hardLimit > 0 && used >= int64(hardLimit) {
		return false, used, hardLimit
	}
	return true, used, hardLimit
}

// GetUserDailyTierMultiplier 返回该用户当前应适用的计费倍率
func GetUserDailyTierMultiplier(userId int, group string, isAdmin bool) float64 {
	if !setting.UserDailyTierEnabled {
		return 1.0
	}
	if isAdmin && setting.UserDailyTierAdminExempt {
		return 1.0
	}
	used := GetUserDailyRequestCount(userId, group)
	return setting.ResolveUserDailyTierMultiplier(used)
}

// IncrUserDailyTierUsage 成功调用后累加计数（仅当启用且非豁免管理员）
func IncrUserDailyTierUsage(userId int, group string, isAdmin bool) {
	if !setting.UserDailyTierEnabled {
		return
	}
	if isAdmin && setting.UserDailyTierAdminExempt {
		return
	}
	IncrUserDailyRequestCount(userId, group)
}
