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

// ModelDailyLimitSharedGroup 共享限额组：组内多个模型共用同一每日计数
// （常用于来自同一渠道的多个模型合计限额）
type ModelDailyLimitSharedGroup struct {
	Name   string         `json:"name"`   // 组名（用于计数标识，需唯一）
	Models []string       `json:"models"` // 组内模型名列表
	Limits map[string]int `json:"limits"` // 分组名 -> 每日上限
}

// ModelDailyLimitGroups 共享限额组配置列表
var ModelDailyLimitGroups = []ModelDailyLimitSharedGroup{}

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

// ModelDailyLimitGroups2JSONString 序列化共享组配置
func ModelDailyLimitGroups2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	jsonBytes, err := json.Marshal(ModelDailyLimitGroups)
	if err != nil {
		common.SysLog("error marshalling model daily limit groups: " + err.Error())
	}
	return string(jsonBytes)
}

// UpdateModelDailyLimitGroupsByJSONString 从 JSON 更新共享组配置
func UpdateModelDailyLimitGroupsByJSONString(jsonStr string) error {
	ModelDailyLimitMutex.Lock()
	defer ModelDailyLimitMutex.Unlock()

	newGroups := make([]ModelDailyLimitSharedGroup, 0)
	if jsonStr == "" {
		ModelDailyLimitGroups = newGroups
		return nil
	}
	if err := json.Unmarshal([]byte(jsonStr), &newGroups); err != nil {
		return err
	}
	ModelDailyLimitGroups = newGroups
	return nil
}

// modelDailyLimitSharedCounterPrefix 共享组计数标识前缀，避免与真实模型名冲突
const modelDailyLimitSharedCounterPrefix = "__group__:"

// ResolveModelDailyLimit 返回指定模型在指定分组下适用的计数标识与每日上限。
// 优先匹配共享限额组（模型在组内且该分组配置了上限），命中时计数标识为
// "__group__:<组名>"，组内所有模型共享同一计数；否则回退到单模型配置，
// 计数标识即模型名。found=false 表示未配置（不限制）。
func ResolveModelDailyLimit(modelName, group string) (counterName string, limit int, found bool) {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	// 共享组优先，避免同一次调用被重复计数
	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || len(sg.Limits) == 0 {
			continue
		}
		if !containsString(sg.Models, modelName) {
			continue
		}
		if l, ok := sg.Limits[group]; ok && l > 0 {
			return modelDailyLimitSharedCounterPrefix + sg.Name, l, true
		}
	}

	// 回退单模型配置
	if ModelDailyLimit != nil {
		if groups, ok := ModelDailyLimit[modelName]; ok {
			if l, ok := groups[group]; ok && l > 0 {
				return modelName, l, true
			}
		}
	}
	return "", 0, false
}

func containsString(list []string, target string) bool {
	for _, v := range list {
		if v == target {
			return true
		}
	}
	return false
}

// ModelDailyLimitDisplayEntry 用于接口展示的单条限额信息
type ModelDailyLimitDisplayEntry struct {
	Limit       int
	CounterName string
}

// GetModelDailyLimitDisplayCopy 返回用于展示的合并配置：模型名 -> 分组名 -> 限额信息。
// 共享组会展开到其每个成员模型上，且共享组优先于单模型配置。
func GetModelDailyLimitDisplayCopy() map[string]map[string]ModelDailyLimitDisplayEntry {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	result := make(map[string]map[string]ModelDailyLimitDisplayEntry)

	// 先填单模型配置
	for modelName, groups := range ModelDailyLimit {
		for g, limit := range groups {
			if limit <= 0 {
				continue
			}
			if result[modelName] == nil {
				result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
			}
			result[modelName][g] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: modelName}
		}
	}

	// 再用共享组覆盖（共享组优先）
	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || len(sg.Limits) == 0 {
			continue
		}
		counter := modelDailyLimitSharedCounterPrefix + sg.Name
		for _, modelName := range sg.Models {
			for g, limit := range sg.Limits {
				if limit <= 0 {
					continue
				}
				if result[modelName] == nil {
					result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
				}
				result[modelName][g] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: counter}
			}
		}
	}

	return result
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
