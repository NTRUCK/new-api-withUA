package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// 模型每日调用计数服务
// 统计口径：仅成功调用；重置方式：自然日零点（按服务器本地时区）
// 计数粒度：模型名 + 分组，分组内所有用户共享同一计数

const modelDailyLimitRedisPrefix = "modelDailyLimit"

// 内存计数回退实现
type memoryDailyCounter struct {
	mu    sync.Mutex
	day   string           // 当前统计的自然日 (2006-01-02)
	count map[string]int64 // key(model:group) -> 已用次数
}

var memDailyCounter = &memoryDailyCounter{
	count: make(map[string]int64),
}

// dayString 返回当前自然日字符串（服务器本地时区）
func dayString() string {
	return time.Now().Format("2006-01-02")
}

// secondsUntilEndOfDay 返回距离当天 24:00 的剩余秒数，用于设置计数 key 的过期时间
func secondsUntilEndOfDay() int64 {
	now := time.Now()
	year, month, day := now.Date()
	endOfDay := time.Date(year, month, day, 23, 59, 59, 0, now.Location())
	secs := int64(endOfDay.Sub(now).Seconds()) + 1
	if secs < 1 {
		secs = 1
	}
	return secs
}

func modelDailyLimitKey(modelName, group string) string {
	return fmt.Sprintf("%s:%s:%s:%s", modelDailyLimitRedisPrefix, dayString(), modelName, group)
}

func memoryCounterKey(modelName, group string) string {
	return fmt.Sprintf("%s:%s", modelName, group)
}

// GetModelDailyUsage 返回指定模型在指定分组当天已用的成功调用次数
func GetModelDailyUsage(modelName, group string) int64 {
	if common.RedisEnabled {
		ctx := context.Background()
		val, err := common.RDB.Get(ctx, modelDailyLimitKey(modelName, group)).Int64()
		if err != nil {
			return 0
		}
		return val
	}

	memDailyCounter.mu.Lock()
	defer memDailyCounter.mu.Unlock()
	if memDailyCounter.day != dayString() {
		return 0
	}
	return memDailyCounter.count[memoryCounterKey(modelName, group)]
}

// CheckModelDailyLimit 检查是否超过每日限额。返回 (allowed, limit, used)。
// 当模型/分组未配置限额时，allowed=true 且 found 相关值为 0。
func CheckModelDailyLimit(modelName, group string) (allowed bool, limit int, used int64) {
	if !setting.ModelDailyLimitEnabled {
		return true, 0, 0
	}
	limit, found := setting.GetModelDailyLimit(modelName, group)
	if !found {
		return true, 0, 0
	}
	used = GetModelDailyUsage(modelName, group)
	if used >= int64(limit) {
		return false, limit, used
	}
	return true, limit, used
}

// IncrModelDailyUsage 在一次成功调用后，将对应模型/分组的当日计数加一
func IncrModelDailyUsage(modelName, group string) {
	if !setting.ModelDailyLimitEnabled {
		return
	}
	if _, found := setting.GetModelDailyLimit(modelName, group); !found {
		return
	}

	if common.RedisEnabled {
		ctx := context.Background()
		key := modelDailyLimitKey(modelName, group)
		pipe := common.RDB.TxPipeline()
		incr := pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, time.Duration(secondsUntilEndOfDay())*time.Second)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError("failed to incr model daily usage: " + err.Error())
			return
		}
		_ = incr
		return
	}

	memDailyCounter.mu.Lock()
	defer memDailyCounter.mu.Unlock()
	today := dayString()
	if memDailyCounter.day != today {
		memDailyCounter.day = today
		memDailyCounter.count = make(map[string]int64)
	}
	memDailyCounter.count[memoryCounterKey(modelName, group)]++
}
