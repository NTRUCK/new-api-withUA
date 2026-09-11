package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// 模型每日/分时段调用计数服务。统计口径：仅成功调用；重置时间：北京时间配置整点。
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

// windowCounterKey 生成一个窗口计数器键：counterName + 分组 + 窗口标识。
// 整日模式窗口标识为日期周期（兼容旧键格式）；时段模式为窗口起点时间戳。
func windowCounterKey(prefix, counterName, group string, window setting.ModelLimitWindow) string {
	windowId := window.WindowStart.Format("2006-01-02T15")
	if window.WindowStart.IsZero() {
		period, _ := modelDailyLimitPeriod(time.Now(), window.ResetHour)
		windowId = period
	}
	return fmt.Sprintf("%s:%s:%s:%s", prefix, windowId, counterName, group)
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
	window := setting.ModelLimitWindow{CounterName: counterName, ResetHour: resetHour}
	return getWindowUsage(window, group)
}

// GetWindowUsage 读取一个窗口计数器的当前值（Redis 或内存），供 pricing 展示使用。
func GetWindowUsage(counterName, group string, window setting.ModelLimitWindow) int64 {
	window.CounterName = counterName
	return getWindowUsage(window, group)
}

// getWindowUsage 读取一个窗口计数器的当前值（Redis 或内存）。
func getWindowUsage(window setting.ModelLimitWindow, group string) int64 {
	key := windowCounterKey(modelDailyLimitRedisPrefix, window.CounterName, group, window)
	if common.RedisEnabled {
		value, err := common.RDB.Get(context.Background(), key).Int64()
		if err != nil {
			return 0
		}
		return value
	}

	memDailyCounter.mu.Lock()
	defer memDailyCounter.mu.Unlock()
	return memDailyCounter.count[key]
}

// incrWindowUsage 对窗口计数器 +1，并设置窗口过期时间。
func incrWindowUsage(window setting.ModelLimitWindow, group string) {
	key := windowCounterKey(modelDailyLimitRedisPrefix, window.CounterName, group, window)
	ttl := secondsUntilNextReset(window.ResetHour)
	if !window.WindowEnd.IsZero() {
		ttl = int64(time.Until(window.WindowEnd).Seconds())
		if ttl < 1 {
			ttl = 1
		}
	}

	if common.RedisEnabled {
		ctx := context.Background()
		pipe := common.RDB.TxPipeline()
		pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, time.Duration(ttl)*time.Second)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError("failed to incr model daily usage: " + err.Error())
		}
		return
	}

	memDailyCounter.mu.Lock()
	memDailyCounter.count[key]++
	memDailyCounter.mu.Unlock()
}

// CheckModelDailyLimit 检查模型/分组当前窗口是否允许调用。
// 未配置限额或时段暂停供应时不允许（后者 limit=0 供调用方区分文案）。
func CheckModelDailyLimit(modelName, group string) (allowed bool, limit int, used int64) {
	if !setting.ModelDailyLimitEnabled {
		return true, 0, 0
	}
	window := setting.ResolveModelLimitWindow(modelName, group)
	if !window.Found {
		return true, 0, 0
	}
	if !window.InSupply {
		return false, 0, 0
	}
	used = getWindowUsage(window, group)
	return used < int64(window.Limit), window.Limit, used
}

func GetModelDailyLimitMultiplier(modelName, group string) float64 {
	if !setting.ModelDailyLimitEnabled {
		return 1
	}
	window := setting.ResolveModelLimitWindow(modelName, group)
	if !window.Found || !window.InSupply || len(window.Tiers) == 0 {
		return 1
	}
	used := getWindowUsage(window, group)
	return setting.ResolveModelDailyLimitMultiplier(window.Tiers, used)
}

func IncrModelDailyUsage(modelName, group string) {
	if !setting.ModelDailyLimitEnabled {
		return
	}
	window := setting.ResolveModelLimitWindow(modelName, group)
	if !window.Found || !window.InSupply {
		return
	}
	incrWindowUsage(window, group)
}
