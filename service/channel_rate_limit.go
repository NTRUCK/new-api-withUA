package service

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/go-redis/redis/v8"
)

// channelRpmWindow 渠道级 RPM 限制的滑动窗口长度。
const channelRpmWindow = time.Minute

// channelRpmScript 渠道级 RPM 滑动窗口限流脚本（ZSET 实现，原子执行）。
// KEYS[1] = rpm:channel:{id}
// ARGV[1] = window_ms 窗口长度（毫秒）
// ARGV[2] = limit     窗口内允许的最大请求数（<=0 表示不限制）
// ARGV[3] = member    本次请求的唯一标识（同 score 下避免成员互相覆盖）
// 返回 1 表示放行，0 表示超限。
var channelRpmScript = redis.NewScript(`
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]

if limit <= 0 then
    return 1
end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

local count = redis.call('ZCARD', key)
if count >= limit then
    return 0
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 1000)
return 1
`)

var (
	channelRpmSeq     uint64
	channelRpmLimiter common.InMemoryRateLimiter
)

// CheckChannelRpmLimit 校验渠道级 RPM 限制（最近 60 秒内不超过该渠道配置的 max_rpm 次）。
// 返回 true 表示允许通过；false 表示已超过该渠道每分钟请求上限。
// 渠道未配置（max_rpm <= 0）时直接放行。
// Redis 不可用时退化为进程内滑动窗口（多实例下各自计数，与并发限制降级行为一致）。
func CheckChannelRpmLimit(channel *model.Channel) (bool, error) {
	if channel == nil {
		return true, nil
	}
	limit := channel.GetSetting().MaxRpm
	if limit <= 0 {
		return true, nil
	}

	key := fmt.Sprintf("rpm:channel:%d", channel.Id)
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		member := fmt.Sprintf("%d-%d", time.Now().UnixNano(), atomic.AddUint64(&channelRpmSeq, 1))
		result, err := channelRpmScript.Run(ctx, common.RDB, []string{key},
			channelRpmWindow.Milliseconds(), limit, member).Int()
		if err != nil {
			return false, err
		}
		return result == 1, nil
	}

	channelRpmLimiter.Init(channelRpmWindow)
	return channelRpmLimiter.Request(key, limit, int64(channelRpmWindow.Seconds())), nil
}
