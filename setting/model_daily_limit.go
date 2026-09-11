package setting

import (
	"fmt"
	"math"
	"sync"
	"time"

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
	// TimeSlots 可选：按分组的分时段供应配置；配置后替代整日 Limits 生效。
	TimeSlots map[string][]ModelTimeSlotLimit `json:"time_slots,omitempty"`
}

var ModelDailyLimitGroups = []ModelDailyLimitSharedGroup{}

// ModelTimeSlotLimit 表示一个分时段供应窗口：[Start, End) 小时（北京时间）。
// End <= Start 表示跨夜时段（如 22:00-06:00）；Limit 为 0 表示该时段暂停供应。
type ModelTimeSlotLimit struct {
	Start int `json:"start"`
	End   int `json:"end"`
	Limit int `json:"limit"`
}

// ModelTimeSlotLimits 结构：模型名 -> 分组名 -> 时段列表。
// 配置后替代该模型/分组的整日每日上限（ModelDailyLimit）生效。
var ModelTimeSlotLimits = map[string]map[string][]ModelTimeSlotLimit{}


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

func ModelTimeSlotLimits2JSONString() string {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return marshalModelDailyLimitConfig(ModelTimeSlotLimits, "model time slot limits")
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

func UpdateModelTimeSlotLimitsByJSONString(jsonStr string) error {
	newSlots := make(map[string]map[string][]ModelTimeSlotLimit)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &newSlots); err != nil {
			return err
		}
	}
	ModelDailyLimitMutex.Lock()
	ModelTimeSlotLimits = newSlots
	ModelDailyLimitMutex.Unlock()
	return nil
}

const modelDailyLimitSharedCounterPrefix = "__group__:"

// timeSlotMatches 判断北京时间 hour 是否命中时段 [Start, End)。
// End > Start 为当日时段；End <= Start 为跨夜时段（如 22:00-06:00）。
func timeSlotMatches(slot ModelTimeSlotLimit, hour int) bool {
	if slot.End > slot.Start {
		return hour >= slot.Start && hour < slot.End
	}
	// 跨夜：命中 [Start,24) 或 [0,End)；0-0 表示全天
	return hour >= slot.Start || hour < slot.End
}

// resolveTimeSlot 从时段列表中解析当前命中的时段（北京时间）。
func resolveTimeSlot(slots []ModelTimeSlotLimit, now time.Time) (ModelTimeSlotLimit, bool) {
	hour, _, _ := now.In(beijingLoc()).Clock()
	for _, slot := range slots {
		if timeSlotMatches(slot, hour) {
			return slot, true
		}
	}
	return ModelTimeSlotLimit{}, false
}

// BeiJing 返回北京时区（每日限额/时段均以北京时间为准）。
func BeiJing() *time.Location {
	return beijingLoc()
}

// beijingLoc 返回北京时区（每日限额/时段均以北京时间为准）。
func beijingLoc() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

// timeSlotWindow 计算当前命中时段的窗口起止（北京时间）。
// 当日窗口为今天 [Start, End)；跨夜窗口起点为今天或昨天的 Start，终点为起点 + (24-Start+End) 小时。
func timeSlotWindow(slot ModelTimeSlotLimit, now time.Time) (time.Time, time.Time) {
	bj := now.In(beijingLoc())
	year, month, day := bj.Date()
	todayStart := time.Date(year, month, day, slot.Start, 0, 0, 0, beijingLoc())
	if slot.End > slot.Start {
		return todayStart, todayStart.Add(time.Duration(slot.End-slot.Start) * time.Hour)
	}
	// 跨夜窗口：若当前在 [0, End)，则窗口起于昨天
	start := todayStart
	if bj.Before(start) {
		start = start.AddDate(0, 0, -1)
	}
	return start, start.Add(time.Duration(24-slot.Start+slot.End) * time.Hour)
}

// ModelLimitWindow 一次模型限额解析的完整结果。
type ModelLimitWindow struct {
	Found       bool                   // 是否命中任何限额配置（时段或整日）
	InSupply    bool                   // 当前时间是否在供应时段内（未配时段时恒为 true）
	CounterName string                 // 计数标识（时段模式含窗口起点，需配合 WindowStart 使用）
	Limit       int                    // 当前窗口上限
	ResetHour   int                    // 整日限额的北京时间重置整点；时段模式为 -1
	Tiers       []ModelDailyLimitTier  // 计费梯度（按窗口内成功序号匹配）
	WindowStart time.Time              // 时段窗口起点（北京时间）；整日模式为零值
	WindowEnd   time.Time              // 时段窗口终点（北京时间）；整日模式为零值
	Slots       []ModelTimeSlotLimit   // 该模型/分组配置的全部时段（展示用）
}

// ResolveModelLimitWindow 解析模型在指定分组的当前限额窗口（内部取当前时间）。
func ResolveModelLimitWindow(modelName, group string) ModelLimitWindow {
	ModelDailyLimitMutex.RLock()
	defer ModelDailyLimitMutex.RUnlock()
	return resolveModelLimitWindowLocked(modelName, group, time.Now())
}

// resolveModelLimitWindowLocked 已持锁的解析实现，支持指定时间（便于测试）。
// 优先级：共享组时段 > 共享组每日 > 单模型时段 > 单模型每日。
func resolveModelLimitWindowLocked(modelName, group string, now time.Time) ModelLimitWindow {
	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" || !containsString(sg.Models, modelName) {
			continue
		}
		if slots, ok := sg.TimeSlots[group]; ok && len(slots) > 0 {
			if slot, hit := resolveTimeSlot(slots, now); hit {
				start, end := timeSlotWindow(slot, now)
				return ModelLimitWindow{
					Found:       true,
					InSupply:    true,
					CounterName: modelDailyLimitSharedCounterPrefix + sg.Name,
					Limit:       slot.Limit,
					ResetHour:   -1,
					Tiers:       copyModelDailyLimitTiers(sg.Tiers[group]),
					WindowStart: start,
					WindowEnd:   end,
					Slots:       copyTimeSlots(slots),
				}
			}
			// 配置了时段但当前未命中：该模型/分组在此时段暂停供应
			return ModelLimitWindow{Found: true, InSupply: false, ResetHour: -1, Slots: copyTimeSlots(slots)}
		}
		if l, ok := sg.Limits[group]; ok && l > 0 {
			return ModelLimitWindow{
				Found:       true,
				InSupply:    true,
				CounterName: modelDailyLimitSharedCounterPrefix + sg.Name,
				Limit:       l,
				ResetHour:   sg.ResetHour,
				Tiers:       copyModelDailyLimitTiers(sg.Tiers[group]),
			}
		}
	}

	if slots, ok := ModelTimeSlotLimits[modelName][group]; ok && len(slots) > 0 {
		if slot, hit := resolveTimeSlot(slots, now); hit {
			start, end := timeSlotWindow(slot, now)
			return ModelLimitWindow{
				Found:       true,
				InSupply:    true,
				CounterName: modelName,
				Limit:       slot.Limit,
				ResetHour:   -1,
				Tiers:       copyModelDailyLimitTiers(ModelDailyLimitTiers[modelName][group]),
				WindowStart: start,
				WindowEnd:   end,
				Slots:       copyTimeSlots(slots),
			}
		}
		return ModelLimitWindow{Found: true, InSupply: false, ResetHour: -1, Slots: copyTimeSlots(slots)}
	}

	if groups, ok := ModelDailyLimit[modelName]; ok {
		if l, ok := groups[group]; ok && l > 0 {
			return ModelLimitWindow{
				Found:       true,
				InSupply:    true,
				CounterName: modelName,
				Limit:       l,
				ResetHour:   ModelDailyLimitResetHours[modelName],
				Tiers:       copyModelDailyLimitTiers(ModelDailyLimitTiers[modelName][group]),
			}
		}
	}
	return ModelLimitWindow{}
}

func copyTimeSlots(slots []ModelTimeSlotLimit) []ModelTimeSlotLimit {
	return append([]ModelTimeSlotLimit(nil), slots...)
}

// ResolveModelDailyLimit 返回计数标识、上限、重置整点和计费梯度。
// 兼容旧签名：时段未命中时返回 found=false（倍率视为 1）。
func ResolveModelDailyLimit(modelName, group string) (counterName string, limit, resetHour int, tiers []ModelDailyLimitTier, found bool) {
	window := ResolveModelLimitWindow(modelName, group)
	if !window.Found || !window.InSupply {
		return "", 0, 0, nil, false
	}
	return window.CounterName, window.Limit, window.ResetHour, window.Tiers, true
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
	Slots       []ModelTimeSlotLimit
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
	// 单模型分时段配置覆盖整日上限展示
	for modelName, groups := range ModelTimeSlotLimits {
		for group, slots := range groups {
			if len(slots) == 0 {
				continue
			}
			if result[modelName] == nil {
				result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
			}
			entry := result[modelName][group]
			entry.Slots = copyTimeSlots(slots)
			result[modelName][group] = entry
		}
	}
	for _, sg := range ModelDailyLimitGroups {
		if sg.Name == "" {
			continue
		}
		if len(sg.Limits) == 0 && len(sg.TimeSlots) == 0 {
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
				result[modelName][group] = ModelDailyLimitDisplayEntry{Limit: limit, CounterName: counter, ResetHour: sg.ResetHour, Tiers: copyModelDailyLimitTiers(sg.Tiers[group])}
			}
			for group, slots := range sg.TimeSlots {
				if len(slots) == 0 {
					continue
				}
				if result[modelName] == nil {
					result[modelName] = make(map[string]ModelDailyLimitDisplayEntry)
				}
				entry := result[modelName][group]
				entry.CounterName = counter
				entry.ResetHour = 0
				entry.Slots = copyTimeSlots(slots)
				result[modelName][group] = entry
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
		for group, slots := range sharedGroup.TimeSlots {
			if err := checkTimeSlots(sharedGroup.Name+"/"+group, slots); err != nil {
				return err
			}
		}
	}
	return nil
}

// checkTimeSlots 校验一个分组下的时段列表：
// Start 需在 0~23，End 需在 0~24（0 视为 24，即 End<=Start 表示跨夜/全天）；Limit 为 0 表示该时段暂停供应；时段间不允许重叠。
func checkTimeSlots(name string, slots []ModelTimeSlotLimit) error {
	// 归一化到 [0,24) 后的占用表，按小时粒度检测重叠
	occupied := make([]bool, 48)
	for index, slot := range slots {
		if slot.Start < 0 || slot.Start > 23 || slot.End < 0 || slot.End > 24 {
			return fmt.Errorf("%s time slot %d hours must be between 0 and 24", name, index+1)
		}
		if slot.Limit < 0 || slot.Limit > math.MaxInt32 {
			return fmt.Errorf("%s time slot %d has invalid limit: %d", name, index+1, slot.Limit)
		}
		start := slot.Start
		end := slot.End
		if end == 0 {
			end = 24
		}
		if end <= start {
			end += 24
		}
		for h := start; h < end; h++ {
			// 跨夜时段 h 可能 >= 24，取模归一化
			idx := (h % 24) * 2
			if occupied[idx] || occupied[idx+1] {
				return fmt.Errorf("%s time slots overlap at hour %d", name, h%24)
			}
			occupied[idx] = true
			occupied[idx+1] = true
		}
	}
	return nil
}

// CheckModelTimeSlotLimits 校验单模型分时段配置 JSON。
func CheckModelTimeSlotLimits(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	check := make(map[string]map[string][]ModelTimeSlotLimit)
	if err := common.UnmarshalJsonStr(jsonStr, &check); err != nil {
		return err
	}
	for modelName, groups := range check {
		if modelName == "" {
			return fmt.Errorf("model name cannot be empty")
		}
		for group, slots := range groups {
			if group == "" {
				return fmt.Errorf("group name of model %s cannot be empty", modelName)
			}
			if err := checkTimeSlots(modelName+"/"+group, slots); err != nil {
				return err
			}
		}
	}
	return nil
}
