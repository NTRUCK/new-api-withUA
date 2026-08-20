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
local acquired = 0
for i = 1, #KEYS do
    local limit = tonumber(ARGV[i])
    local current = tonumber(redis.call('GET', KEYS[i]) or '0')
    if limit > 0 and current >= limit then
        return 0
    end
end
for i = 1, #KEYS do
    if tonumber(ARGV[i]) > 0 then
        redis.call('INCR', KEYS[i])
        redis.call('EXPIRE', KEYS[i], ARGV[#KEYS + 1])
        acquired = 1
    end
end
return acquired
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

func TryAcquireConcurrency(channel *model.Channel, modelName string) (*ConcurrencyLease, bool, error) {
	keys := make([]string, 0, 2)
	limits := make([]int, 0, 2)
	if limit := channel.GetSetting().MaxConcurrency; limit > 0 {
		keys = append(keys, fmt.Sprintf("concurrency:channel:%d", channel.Id))
		limits = append(limits, limit)
	}
	if limit := setting.GetModelConcurrencyLimit(modelName); limit > 0 {
		keys = append(keys, "concurrency:model:"+modelName)
		limits = append(limits, limit)
	}
	if len(keys) == 0 {
		return &ConcurrencyLease{}, true, nil
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
			return nil, false, err
		}
		return &ConcurrencyLease{keys: keys, redis: true}, result == 1, nil
	}

	concurrencyMu.Lock()
	defer concurrencyMu.Unlock()
	for i, key := range keys {
		if concurrencyCounts[key] >= limits[i] {
			return nil, false, nil
		}
	}
	for _, key := range keys {
		concurrencyCounts[key]++
	}
	return &ConcurrencyLease{keys: keys}, true, nil
}
