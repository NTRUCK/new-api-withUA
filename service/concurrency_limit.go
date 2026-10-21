package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

const concurrencyKeyTTL = 24 * time.Hour

var (
	concurrencyMu     sync.Mutex
	concurrencyCounts = make(map[string]int)
)

var acquireConcurrencyScript = `
for i = 1, #KEYS do
    local limit = tonumber(ARGV[i])
    local current = tonumber(redis.call('GET', KEYS[i]) or '0')
    if limit > 0 and current >= limit then
        return i
    end
end
for i = 1, #KEYS do
    if tonumber(ARGV[i]) > 0 then
        redis.call('INCR', KEYS[i])
        redis.call('EXPIRE', KEYS[i], ARGV[#KEYS + 1])
    end
end
return -1
`

var releaseConcurrencyScript = `
for i = 1, #KEYS do
    local current = tonumber(redis.call('GET', KEYS[i]) or '0')
    if current <= 1 then
        redis.call('DEL', KEYS[i])
    else
        redis.call('DECR', KEYS[i])
    end
end
return 1
`

type ConcurrencyLease struct {
	keys  []string
	redis bool
	once  sync.Once
}

func (l *ConcurrencyLease) Release() {
	if l == nil {
		return
	}
	l.once.Do(func() {
		if l.redis && common.RedisEnabled && common.RDB != nil {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_, _ = common.RDB.Eval(ctx, releaseConcurrencyScript, l.keys).Result()
			return
		}
		concurrencyMu.Lock()
		defer concurrencyMu.Unlock()
		for _, key := range l.keys {
			if concurrencyCounts[key] <= 1 {
				delete(concurrencyCounts, key)
			} else {
				concurrencyCounts[key]--
			}
		}
	})
}

// ConcurrencyLimitReason 表示并发获取失败时命中的限制维度。
type ConcurrencyLimitReason int

const (
	ConcurrencyLimitNone ConcurrencyLimitReason = iota
	ConcurrencyLimitChannel
	ConcurrencyLimitModel
	ConcurrencyLimitUser
)

func (r ConcurrencyLimitReason) String() string {
	switch r {
	case ConcurrencyLimitChannel:
		return "channel"
	case ConcurrencyLimitModel:
		return "model"
	case ConcurrencyLimitUser:
		return "user"
	default:
		return "none"
	}
}

func TryAcquireConcurrency(channel *model.Channel, modelName string, userId int) (*ConcurrencyLease, ConcurrencyLimitReason, error) {
	keys := make([]string, 0, 3)
	limits := make([]int, 0, 3)
	reasons := make([]ConcurrencyLimitReason, 0, 3)
	if limit := channel.GetSetting().MaxConcurrency; limit > 0 {
		keys = append(keys, fmt.Sprintf("concurrency:channel:%d", channel.Id))
		limits = append(limits, limit)
		reasons = append(reasons, ConcurrencyLimitChannel)
	}
	if limit := setting.GetModelConcurrencyLimit(modelName); limit > 0 {
		keys = append(keys, "concurrency:model:"+modelName)
		limits = append(limits, limit)
		reasons = append(reasons, ConcurrencyLimitModel)
	}
	if limit := getUserConcurrencyLimit(userId); limit > 0 {
		keys = append(keys, fmt.Sprintf("concurrency:user:%d", userId))
		limits = append(limits, limit)
		reasons = append(reasons, ConcurrencyLimitUser)
	}
	if len(keys) == 0 {
		return &ConcurrencyLease{}, ConcurrencyLimitNone, nil
	}

	if common.RedisEnabled && common.RDB != nil {
		args := make([]interface{}, 0, len(limits)+1)
		for _, limit := range limits {
			args = append(args, limit)
		}
		args = append(args, int(concurrencyKeyTTL/time.Second))
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		result, err := common.RDB.Eval(ctx, acquireConcurrencyScript, keys, args...).Int()
		if err != nil {
			return nil, ConcurrencyLimitNone, err
		}
		if result > 0 && result <= len(reasons) {
			return nil, reasons[result-1], nil
		}
		return &ConcurrencyLease{keys: keys, redis: true}, ConcurrencyLimitNone, nil
	}

	concurrencyMu.Lock()
	defer concurrencyMu.Unlock()
	for i, key := range keys {
		if concurrencyCounts[key] >= limits[i] {
			return nil, reasons[i], nil
		}
	}
	for _, key := range keys {
		concurrencyCounts[key]++
	}
	return &ConcurrencyLease{keys: keys}, ConcurrencyLimitNone, nil
}

// getUserConcurrencyLimit 读取用户级并发上限，0 表示不限制。
// 缓存/数据库读取失败时按不限制处理，避免因缓存抖动阻塞正常请求。
func getUserConcurrencyLimit(userId int) int {
	if userId <= 0 {
		return 0
	}
	userCache, err := model.GetUserCache(userId)
	if err != nil || userCache == nil {
		return 0
	}
	return userCache.MaxConcurrency
}
