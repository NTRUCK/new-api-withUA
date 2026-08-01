package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// NotifyTypeUserAgentBan 分组 UA 违规封禁通知类型
const NotifyTypeUserAgentBan = "user_agent_ban"

// uaViolationWindow 违规计数的滑动窗口时长
const uaViolationWindow = 24 * time.Hour

// 内存兜底计数（Redis 不可用时使用）
var (
	uaViolationStore sync.Map // key: userId:group -> *uaViolationCount
)

type uaViolationCount struct {
	count     int
	expiresAt time.Time
}

// HandleUserAgentGroupViolation 处理一次分组 UA 违规：累计计数，达到阈值后禁用用户（不上榜）
// 并通知根用户、写管理日志。返回是否已封禁。调用方仍应拒绝本次请求。
func HandleUserAgentGroupViolation(userId int, group, userAgent, reason string) bool {
	threshold := operation_setting.UserAgentGroupBanThreshold
	if threshold < 1 {
		threshold = 5
	}
	count := incrUAViolation(userId, group)
	if count < threshold {
		return false
	}
	banned, err := model.DisableUserByGroupPolicy(userId)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to disable user %d by group ua policy: %s", userId, err.Error()))
		return false
	}
	if !banned {
		return false
	}
	resetUAViolation(userId, group)

	subject := "用户因客户端 User-Agent 违规被自动封禁"
	content := fmt.Sprintf(
		"用户 ID %d 在分组「%s」累计 %d 次使用不合规客户端，已被自动封禁。\n原因：%s\nUser-Agent：%s",
		userId, group, count, reason, userAgent,
	)
	NotifyRootUser(NotifyTypeUserAgentBan, subject, content)
	model.RecordLogWithAdminInfo(userId, model.LogTypeManage,
		fmt.Sprintf("用户因分组 UA 违规累计 %d 次被自动封禁（%s）", count, reason), map[string]interface{}{
			"group":      group,
			"user_agent": userAgent,
			"reason":     reason,
			"count":      count,
		})
	return true
}

func incrUAViolation(userId int, group string) int {
	if common.RedisEnabled {
		key := fmt.Sprintf("ua_violation:%d:%s", userId, group)
		val, err := common.RedisGet(key)
		if err != nil || val == "" {
			if setErr := common.RedisSet(key, "1", uaViolationWindow); setErr != nil {
				common.SysLog(fmt.Sprintf("failed to set ua violation count: %s", setErr.Error()))
			}
			return 1
		}
		if incrErr := common.RedisIncr(key, 1); incrErr != nil {
			common.SysLog(fmt.Sprintf("failed to incr ua violation count: %s", incrErr.Error()))
		}
		var cur int
		fmt.Sscanf(val, "%d", &cur)
		return cur + 1
	}
	// 内存兜底
	now := time.Now()
	key := fmt.Sprintf("%d:%s", userId, group)
	if v, ok := uaViolationStore.Load(key); ok {
		if c, ok := v.(*uaViolationCount); ok && now.Before(c.expiresAt) {
			c.count++
			return c.count
		}
	}
	uaViolationStore.Store(key, &uaViolationCount{count: 1, expiresAt: now.Add(uaViolationWindow)})
	return 1
}

func resetUAViolation(userId int, group string) {
	if common.RedisEnabled {
		key := fmt.Sprintf("ua_violation:%d:%s", userId, group)
		_ = common.RedisSet(key, "0", time.Second)
		return
	}
	uaViolationStore.Delete(fmt.Sprintf("%d:%s", userId, group))
}
