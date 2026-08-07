package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// 模型每日调用计数服务。统计口径：仅成功调用；重置时间：服务器时区配置整点。
const modelDailyLimitRedisPrefix = "modelDailyLimit"

type memoryDailyCounter struct {
	mu    sync.Mutex
	count map[string]int64
}

var memDailyCounter = &memoryDailyCounter{count: make(map[string]int64)}

// modelDailyLimitPeriod 返回当前请求所属的服务器时区计数周期及下一次重置时间。
func modelDailyLimitPeriod(now time.Time, resetHour int) (string, time.Time) {
	localNow := now.In(time.Local)
	year, month, day := localNow.Date()
	todayReset := time.Date(year, month, day, resetHour, 0, 0, 0, time.Local)
	periodStart := todayReset
	if localNow.Before(todayReset) {
		periodStart = todayReset.AddDate(0, 0, -1)
	}
	return periodStart.Format("2006-01-02T15"), periodStart.AddDate(0, 0, 1)
}

func modelDailyLimitKey(counterName, group string, resetHour int) string {
	period, _ := modelDailyLimitPeriod(time.Now(), resetHour)
	return fmt.Sprintf("%s:%s:%s:%s", modelDailyLimitRedisPrefix, period, counterName, group)
}

func memoryCounterKey(counterName, group string, resetHour int) string {
	period, _ := modelDailyLimitPeriod(time.Now(), resetHour)
	return fmt.Sprintf("%s:%s:%s", period, counterName, group)
}

func secondsUntilNextReset(resetHour int) int64 {
	_, nextReset := modelDailyLimitPeriod(time.Now(), resetHour)
	seconds := int64(time.Until(nextReset).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}

// GetModelDailyUsage 返回指定计数标识在当前配置周期内已用的成功调用次数。
func GetModelDailyUsage(counterName, group string, resetHour int) int64 {
	if common.RedisEnabled {
		value, err := common.RDB.Get(context.Background(), modelDailyLimitKey(counterName, group, resetHour)).Int64()
		if err != nil {
			return 0
		}
		return value
	}

	memDailyCounter.mu.Lock()
	defer memDailyCounter.mu.Unlock()
	return memDailyCounter.count[memoryCounterKey(counterName, group, resetHour)]
}

func CheckModelDailyLimit(modelName, group string) (allowed bool, limit int, used int64) {
	if !setting.ModelDailyLimitEnabled {
		return true, 0, 0
	}
	counterName, limit, resetHour, found := setting.ResolveModelDailyLimit(modelName, group)
	if !found {
		return true, 0, 0
	}
	used = GetModelDailyUsage(counterName, group, resetHour)
	return used < int64(limit), limit, used
}

func IncrModelDailyUsage(modelName, group string) {
	if !setting.ModelDailyLimitEnabled {
		return
	}
	counterName, _, resetHour, found := setting.ResolveModelDailyLimit(modelName, group)
	if !found {
		return
	}

	if common.RedisEnabled {
		ctx := context.Background()
		key := modelDailyLimitKey(counterName, group, resetHour)
		pipe := common.RDB.TxPipeline()
		pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, time.Duration(secondsUntilNextReset(resetHour))*time.Second)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError("failed to incr model daily usage: " + err.Error())
		}
		return
	}

	memDailyCounter.mu.Lock()
	memDailyCounter.count[memoryCounterKey(counterName, group, resetHour)]++
	memDailyCounter.mu.Unlock()
}
