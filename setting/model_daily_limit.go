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

// ModelDailyLimitTier 表示按当日请求序号匹配的计费倍率区间（闭区间）。
type ModelDailyLimitTier struct {
	From       int     `json:"from"`
	To         int     `json:"to"`
	Multiplier float64 `json:"multiplier"`
}

// ModelDailyLimitTiers 结构：模型名 -> 分组名 -> 计费梯度。
var ModelDailyLimitTiers = map[string]map[string][]ModelDailyLimitTier{}

// ModelDailyLimitResetHours 结构：模型名 -> 北京时间每日重置整点（0~23）。
// 未配置的模型默认 0 点重置；同一模型跨分组共用同一重置时间。
var ModelDailyLimitResetHours = map[string]int{}

// ModelDailyLimitSharedGroup 共享限额组：组内多个模型共用同一每日计数。
type ModelDailyLimitSharedGroup struct {
	Name      string                           `json:"name"`
	Models    []string                         `json:"models"`
	Limits    map[string]int                   `json:"limits"`
	Tiers     map[string][]ModelDailyLimitTier `json:"tiers,omitempty"`
	ResetHour int                              `json:"reset_hour,omitempty"`
}

var ModelDailyLimitGroups = []ModelDailyLimitSharedGroup{}

var ModelDailyLimitMutex sync.RWMutex

func ModelDailyLimit2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelDailyLimit, "model daily limit")
}

func ModelDailyLimitTiers2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelDailyLimitTiers, "model daily limit tiers")
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

func UpdateModelDailyLimitTiersByJSONString(jsonStr string) error {
	newTiers := make(map[string]map[string][]ModelDailyLimitTier)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &newTiers); err != nil {
			return err
		}
	}
	ModelDailyLimitMutex.Lock()
	ModelDailyLimitTiers = newTiers
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

// ResolveModelDailyLimit 返回计数标识、上限、重置整点和计费梯度。
func ResolveModelDailyLimit(modelName, group string) (counterName string, limit, resetHour int, tiers []ModelDailyLimitTier, found bool) {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()

	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || len(sg.Limits) == 0 || !containsString(sg.Models, modelName) {
			continue
		}
		if l, ok := sg.Limits[group]; ok && l > 0 {
			return modelDailyLimitSharedCounterPrefix + sg.Name, l, sg.ResetHour, copyModelDailyLimitTiers(sg.Tiers[group]), true
		}
	}

	if groups, ok := ModelDailyLimit[modelName]; ok {
		if l, ok := groups[group]; ok && l > 0 {
			return modelName, l, ModelDailyLimitResetHours[modelName], copyModelDailyLimitTiers(ModelDailyLimitTiers[modelName][group]), true
		}
	}
	return "", 0, 0, nil, false
}

func copyModelDailyLimitTiers(tiers []ModelDailyLimitTier) []ModelDailyLimitTier {
	return append([]ModelDailyLimitTier(nil), tiers...)
}

// ResolveModelDailyLimitMultiplier 按当前请求序号（已成功次数 + 1）解析倍率。
func ResolveModelDailyLimitMultiplier(tiers []ModelDailyLimitTier, used int64) float64 {
	requestNumber := used + 1
	for _, tier := range tiers {
		if requestNumber >= int64(tier.From) && requestNumber <= int64(tier.To) {
			return tier.Multiplier
		}
	}
	return 1
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
	Tiers       []ModelDailyLimitTier
	SharedGroup string
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
			result[modelName][group] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: modelName, ResetHour: ModelDailyLimitResetHours[modelName], Tiers: copyModelDailyLimitTiers(ModelDailyLimitTiers[modelName][group])}
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
				result[modelName][group] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: counter, ResetHour: sg.ResetHour, Tiers: copyModelDailyLimitTiers(sg.Tiers[group]), SharedGroup: sg.Name}
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

func CheckModelDailyLimitTiers(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	check := make(map[string]map[string][]ModelDailyLimitTier)
	if err := common.UnmarshalJsonStr(jsonStr, &check); err != nil {
		return err
	}
	for modelName, groups := range check {
		for group, tiers := range groups {
			limit := ModelDailyLimit[modelName][group]
			if err := checkDailyLimitTiers(modelName+"/"+group, tiers, limit); err != nil {
				return err
			}
		}
	}
	return nil
}

func checkDailyLimitTiers(name string, tiers []ModelDailyLimitTier, limit int) error {
	previousTo := 0
	for index, tier := range tiers {
		if tier.From < 1 || tier.To < tier.From || tier.Multiplier <= 0 {
			return fmt.Errorf("%s tier %d is invalid", name, index+1)
		}
		if index > 0 && tier.From <= previousTo {
			return fmt.Errorf("%s tiers overlap", name)
		}
		if limit > 0 && tier.To > limit {
			return fmt.Errorf("%s tier end %d exceeds daily limit %d", name, tier.To, limit)
		}
		previousTo = tier.To
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
			if err := checkDailyLimitTiers(sharedGroup.Name+"/"+group, sharedGroup.Tiers[group], limit); err != nil {
				return err
			}
		}
	}
	return nil
}
