package setting

import (
	"fmt"
	"math"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// ModelDailyLimitEnabled 控制是否启用「模型-分组」每日调用次数限制
var ModelDailyLimitEnabled = false

// ModelDailyLimit 结构：模型名 -> 分组名 -> 每日最大成功调用次数
var ModelDailyLimit = map[string]map[string]int{}

// ModelDailyLimitResetHours 结构：模型名 -> 北京时间每日重置整点（0~23）。
// 未配置的模型默认 0 点重置；同一模型跨分组共用同一重置时间。
var ModelDailyLimitResetHours = map[string]int{}

// ModelDailyLimitSharedGroup 共享限额组：组内多个模型共用同一每日计数。
type ModelDailyLimitSharedGroup struct {
	Name      string         `json:"name"`
	Models    []string       `json:"models"`
	Limits    map[string]int `json:"limits"`
	ResetHour int            `json:"reset_hour,omitempty"`
}

var ModelDailyLimitGroups = []ModelDailyLimitSharedGroup{}

var ModelDailyLimitMutex sync.RWMutex

func ModelDailyLimit2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelDailyLimit, "model daily limit")
}

func ModelDailyLimitResetHours2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelDailyLimitResetHours, "model daily limit reset hours")
}

func ModelDailyLimitGroups2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelDailyLimitGroups, "model daily limit groups")
}

func marshalModelDailyLimitConfig(value any, name string) string {
	jsonBytes, err := common.Marshal(value)
	if err != nil {
		common.SysLog("error marshalling " + name + ": " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateModelDailyLimitByJSONString(jsonStr string) error {
	newLimit := make(map[string]map[string]int)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &newLimit); err != nil {
			return err
		}
	}
	ModelDailyLimitMutex.Lock()
	ModelDailyLimit = newLimit
	ModelDailyLimitMutex.Unlock()
	return nil
}

func UpdateModelDailyLimitResetHoursByJSONString(jsonStr string) error {
	newHours := make(map[string]int)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &newHours); err != nil {
			return err
		}
	}
	ModelDailyLimitMutex.Lock()
	ModelDailyLimitResetHours = newHours
	ModelDailyLimitMutex.Unlock()
	return nil
}

func UpdateModelDailyLimitGroupsByJSONString(jsonStr string) error {
	newGroups := make([]ModelDailyLimitSharedGroup, 0)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &newGroups); err != nil {
			return err
		}
	}
	ModelDailyLimitMutex.Lock()
	ModelDailyLimitGroups = newGroups
	ModelDailyLimitMutex.Unlock()
	return nil
}

const modelDailyLimitSharedCounterPrefix = "__group__:"

// ResolveModelDailyLimit 返回计数标识、上限和北京时间重置整点。
func ResolveModelDailyLimit(modelName, group string) (counterName string, limit, resetHour int, found bool) {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || len(sg.Limits) == 0 || !containsString(sg.Models, modelName) {
			continue
		}
		if l, ok := sg.Limits[group]; ok && l > 0 {
			return modelDailyLimitSharedCounterPrefix + sg.Name, l, sg.ResetHour, true
		}
	}

	if groups, ok := ModelDailyLimit[modelName]; ok {
		if l, ok := groups[group]; ok && l > 0 {
			return modelName, l, ModelDailyLimitResetHours[modelName], true
		}
	}
	return "", 0, 0, false
}

func containsString(list []string, target string) bool {
	for _, v := range list {
		if v == target {
			return true
		}
	}
	return false
}

type ModelDailyLimitDisplayEntry struct {
	Limit       int
	CounterName string
	ResetHour   int
}

func GetModelDailyLimitDisplayCopy() map[string]map[string]ModelDailyLimitDisplayEntry {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	result := make(map[string]map[string]ModelDailyLimitDisplayEntry)
	for modelName, groups := range ModelDailyLimit {
		for group, limit := range groups {
			if limit <= 0 {
				continue
			}
			if result[modelName] == nil {
				result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
			}
			result[modelName][group] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: modelName, ResetHour: ModelDailyLimitResetHours[modelName]}
		}
	}
	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || len(sg.Limits) == 0 {
			continue
		}
		counter := modelDailyLimitSharedCounterPrefix + sg.Name
		for _, modelName := range sg.Models {
			for group, limit := range sg.Limits {
				if limit <= 0 {
					continue
				}
				if result[modelName] == nil {
					result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
				}
				result[modelName][group] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: counter, ResetHour: sg.ResetHour}
			}
		}
	}
	return result
}

func GetModelDailyLimit(modelName, group string) (limit int, found bool) {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	groups, ok := ModelDailyLimit[modelName]
	if !ok {
		return 0, false
	}
	limit, ok = groups[group]
	return limit, ok && limit > 0
}

func GetModelDailyLimitCopy() map[string]map[string]int {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	cp := make(map[string]map[string]int, len(ModelDailyLimit))
	for modelName, groups := range ModelDailyLimit {
		groupCopy := make(map[string]int, len(groups))
		for group, value := range groups {
			groupCopy[group] = value
		}
		cp[modelName] = groupCopy
	}
	return cp
}

func CheckModelDailyLimit(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	check := make(map[string]map[string]int)
	if err := common.UnmarshalJsonStr(jsonStr, &check); err != nil {
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
			if limit < 1 || limit > math.MaxInt32 {
				return fmt.Errorf("model %s group %s has invalid daily limit: %d", modelName, group, limit)
			}
		}
	}
	return nil
}

func CheckModelDailyLimitResetHours(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	check := make(map[string]int)
	if err := common.UnmarshalJsonStr(jsonStr, &check); err != nil {
		return err
	}
	for modelName, hour := range check {
		if modelName == "" {
			return fmt.Errorf("model name cannot be empty")
		}
		if hour < 0 || hour > 23 {
			return fmt.Errorf("model %s reset hour must be between 0 and 23", modelName)
		}
	}
	return nil
}

func CheckModelDailyLimitGroups(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	groups := make([]ModelDailyLimitSharedGroup, 0)
	if err := common.UnmarshalJsonStr(jsonStr, &groups); err != nil {
		return err
	}
	names := make(map[string]struct{}, len(groups))
	for _, sharedGroup := range groups {
		if sharedGroup.Name == "" {
			return fmt.Errorf("shared limit group name cannot be empty")
		}
		if _, exists := names[sharedGroup.Name]; exists {
			return fmt.Errorf("shared limit group name %s is duplicated", sharedGroup.Name)
		}
		names[sharedGroup.Name] = struct{}{}
		if sharedGroup.ResetHour < 0 || sharedGroup.ResetHour > 23 {
			return fmt.Errorf("shared limit group %s reset hour must be between 0 and 23", sharedGroup.Name)
		}
		for group, limit := range sharedGroup.Limits {
			if group == "" || limit < 1 || limit > math.MaxInt32 {
				return fmt.Errorf("shared limit group %s has invalid limit for group %s", sharedGroup.Name, group)
			}
		}
	}
	return nil
}
