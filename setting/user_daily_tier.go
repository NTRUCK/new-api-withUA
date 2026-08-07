package setting

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// UserDailyTierEnabled 控制是否启用「用户级每日请求次数梯度计费」
var UserDailyTierEnabled = false

// UserDailyTierAdminExempt 管理员（role >= admin）是否豁免梯度计费与硬限额
var UserDailyTierAdminExempt = true

// UserDailyTierResetHour 每日次数重置小时（服务器本地时区，0-23）
var UserDailyTierResetHour = 0

// UserDailyTierHardLimit 每日最大请求次数硬限额，达到后拒绝请求（0 表示不限制）
var UserDailyTierHardLimit = 0

// UserDailyTier 单条梯度：当日请求次数落在 [From, To] 区间时按 Multiplier 倍计费
// To < 0 表示无上限（到无穷）
type UserDailyTier struct {
	From       int     `json:"from"`
	To         int     `json:"to"`
	Multiplier float64 `json:"multiplier"`
}

// UserDailyTiers 梯度配置列表
var UserDailyTiers = []UserDailyTier{}

var userDailyTierMutex sync.RWMutex

// UserDailyTier2JSONString 序列化梯度配置
func UserDailyTier2JSONString() string {
	userDailyTierMutex.RLock()
	defer userDailyTierMutex.RUnlock()
	jsonBytes, err := json.Marshal(UserDailyTiers)
	if err != nil {
		common.SysLog("error marshalling user daily tier: " + err.Error())
	}
	return string(jsonBytes)
}

// UpdateUserDailyTierByJSONString 从 JSON 更新梯度配置
func UpdateUserDailyTierByJSONString(jsonStr string) error {
	if err := CheckUserDailyTier(jsonStr); err != nil {
		return err
	}
	userDailyTierMutex.Lock()
	defer userDailyTierMutex.Unlock()
	newTiers := make([]UserDailyTier, 0)
	if jsonStr == "" {
		UserDailyTiers = newTiers
		return nil
	}
	if err := json.Unmarshal([]byte(jsonStr), &newTiers); err != nil {
		return err
	}
	UserDailyTiers = newTiers
	return nil
}

// CheckUserDailyTier 校验梯度 JSON 合法性
func CheckUserDailyTier(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	tiers := make([]UserDailyTier, 0)
	if err := json.Unmarshal([]byte(jsonStr), &tiers); err != nil {
		return err
	}
	for i, t := range tiers {
		if t.From < 0 {
			return fmt.Errorf("tier %d: from must be >= 0", i)
		}
		if t.To >= 0 && t.To < t.From {
			return fmt.Errorf("tier %d: to (%d) must be >= from (%d) or -1 for unbounded", i, t.To, t.From)
		}
		if t.Multiplier <= 0 {
			return fmt.Errorf("tier %d: multiplier must be > 0", i)
		}
	}
	return nil
}

// ResolveUserDailyTierMultiplier 根据当日已用请求次数返回计费倍率
// 未命中任何梯度时返回 1.0
func ResolveUserDailyTierMultiplier(used int64) float64 {
	userDailyTierMutex.RLock()
	defer userDailyTierMutex.RUnlock()
	if len(UserDailyTiers) == 0 {
		return 1.0
	}
	sorted := make([]UserDailyTier, len(UserDailyTiers))
	copy(sorted, UserDailyTiers)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].From < sorted[j].From })
	for _, t := range sorted {
		if used >= int64(t.From) && (t.To < 0 || used <= int64(t.To)) {
			return t.Multiplier
		}
	}
	return 1.0
}
