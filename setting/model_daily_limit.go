package setting

import (
	"encoding/json"
	"fmt"
	"math"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// ModelDailyLimitEnabled 控制是否启用「模型-分组」每日调用次数限制
var ModelDailyLimitEnabled = false

// ModelDailyLimit 结构：模型名 -> 分组名 -> 每日最大成功调用次数
// 例如：{"gpt-4": {"default": 300}}
// 表示 default 分组内所有用户对 gpt-4 每个自然日合计最多成功调用 300 次
var ModelDailyLimit = map[string]map[string]int{}
var ModelDailyLimitMutex sync.RWMutex

func ModelDailyLimit2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	jsonBytes, err := json.Marshal(ModelDailyLimit)
	if err != nil {
		common.SysLog("error marshalling model daily limit: " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateModelDailyLimitByJSONString(jsonStr string) error {
	ModelDailyLimitMutex.Lock()
	defer ModelDailyLimitMutex.Unlock()

	newLimit := make(map[string]map[string]int)
	if jsonStr == "" {
		ModelDailyLimit = newLimit
		return nil
	}
	if err := json.Unmarshal([]byte(jsonStr), &newLimit); err != nil {
		return err
	}
	ModelDailyLimit = newLimit
	return nil
}

// GetModelDailyLimit 返回指定模型在指定分组下的每日限额，found=false 表示未配置（即不限制）
func GetModelDailyLimit(modelName, group string) (limit int, found bool) {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	if ModelDailyLimit == nil {
		return 0, false
	}
	groups, ok := ModelDailyLimit[modelName]
	if !ok {
		return 0, false
	}
	limit, ok = groups[group]
	if !ok || limit <= 0 {
		return 0, false
	}
	return limit, true
}

// GetModelDailyLimitCopy 返回配置的只读副本，供接口展示使用
func GetModelDailyLimitCopy() map[string]map[string]int {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	cp := make(map[string]map[string]int, len(ModelDailyLimit))
	for modelName, groups := range ModelDailyLimit {
		groupCopy := make(map[string]int, len(groups))
		for g, v := range groups {
			groupCopy[g] = v
		}
		cp[modelName] = groupCopy
	}
	return cp
}

// CheckModelDailyLimit 校验 JSON 配置的合法性
func CheckModelDailyLimit(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	check := make(map[string]map[string]int)
	if err := json.Unmarshal([]byte(jsonStr), &check); err != nil {
		return err
	}
	for modelName, groups := range check {
		if modelName == "" {
			return fmt.Errorf("model name cannot be empty")
		}
		for group, limit := range groups {
			if group == "" {
				return fmt.Errorf("group name of model %s cannot be empty", modelName)
			}
			if limit < 1 {
				return fmt.Errorf("model %s group %s has invalid daily limit: %d (must be >= 1)", modelName, group, limit)
			}
			if limit > math.MaxInt32 {
				return fmt.Errorf("model %s group %s daily limit exceeds max value 2147483647", modelName, group)
			}
		}
	}
	return nil
}
