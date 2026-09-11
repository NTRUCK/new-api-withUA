package setting

import (
	"testing"
	"time"
)

func bjTime(hour, minute int) time.Time {
	now := time.Now().In(beijingLoc())
	y, m, d := now.Date()
	return time.Date(y, m, d, hour, minute, 0, 0, beijingLoc())
}

// 时段匹配：当日时段、跨夜时段、全天
func TestTimeSlotMatches(t *testing.T) {
	cases := []struct {
		slot ModelTimeSlotLimit
		hour int
		want bool
	}{
		// 当日时段 8-16
		{ModelTimeSlotLimit{Start: 8, End: 16, Limit: 10}, 7, false},
		{ModelTimeSlotLimit{Start: 8, End: 16, Limit: 10}, 8, true},
		{ModelTimeSlotLimit{Start: 8, End: 16, Limit: 10}, 15, true},
		{ModelTimeSlotLimit{Start: 8, End: 16, Limit: 10}, 16, false},
		// 跨夜时段 22-6
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 22, true},
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 23, true},
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 3, true},
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 5, true},
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 6, false},
		{ModelTimeSlotLimit{Start: 22, End: 6, Limit: 10}, 12, false},
		// 全天 0-0（End<=Start 视为跨夜，实际覆盖全天）
		{ModelTimeSlotLimit{Start: 0, End: 0, Limit: 10}, 0, true},
		{ModelTimeSlotLimit{Start: 0, End: 0, Limit: 10}, 23, true},
	}
	for _, tc := range cases {
		if got := timeSlotMatches(tc.slot, tc.hour); got != tc.want {
			t.Fatalf("slot %+v hour %d: got %v, want %v", tc.slot, tc.hour, got, tc.want)
		}
	}
}

// 时段窗口计算：当日窗口、跨夜窗口起点回退一天
func TestTimeSlotWindow(t *testing.T) {
	// 当日 8-16
	start, end := timeSlotWindow(ModelTimeSlotLimit{Start: 8, End: 16}, bjTime(10, 0))
	if start.Hour() != 8 || end.Hour() != 16 || end.Sub(start) != 8*time.Hour {
		t.Fatalf("same-day window: start=%v end=%v", start, end)
	}
	// 跨夜 22-6，当前 23 点：窗口起于今天 22 点
	start, end = timeSlotWindow(ModelTimeSlotLimit{Start: 22, End: 6}, bjTime(23, 0))
	if start.Hour() != 22 || end.Hour() != 6 || end.Sub(start) != 8*time.Hour {
		t.Fatalf("overnight window (before midnight): start=%v end=%v", start, end)
	}
	// 跨夜 22-6，当前凌晨 3 点：窗口起于昨天 22 点
	start, end = timeSlotWindow(ModelTimeSlotLimit{Start: 22, End: 6}, bjTime(3, 0))
	if start.Hour() != 22 || end.Hour() != 6 || end.Sub(start) != 8*time.Hour {
		t.Fatalf("overnight window (after midnight): start=%v end=%v", start, end)
	}
	if !start.Before(bjTime(0, 0)) {
		t.Fatalf("overnight window should start yesterday: %v", start)
	}
}

// 窗口解析优先级：共享组时段 > 共享组每日 > 单模型时段 > 单模型每日
func TestResolveModelLimitWindowPriority(t *testing.T) {
	// 备份并清空全局配置
	oldGroups, oldSlots, oldLimit, oldTiers, oldReset := ModelDailyLimitGroups, ModelTimeSlotLimits, ModelDailyLimit, ModelDailyLimitTiers, ModelDailyLimitResetHours
	defer func() {
		ModelDailyLimitGroups, ModelTimeSlotLimits, ModelDailyLimit, ModelDailyLimitTiers, ModelDailyLimitResetHours = oldGroups, oldSlots, oldLimit, oldTiers, oldReset
	}()

	ModelDailyLimitGroups = []ModelDailyLimitSharedGroup{
		{
			Name:    "sharedA",
			Models:  []string{"gpt-x"},
			Limits:  map[string]int{"default": 999},
			TimeSlots: map[string][]ModelTimeSlotLimit{
				"default": {{Start: 8, End: 16, Limit: 100}},
			},
		},
	}
	ModelTimeSlotLimits = map[string]map[string][]ModelTimeSlotLimit{
		"claude-y": {"default": {{Start: 0, End: 8, Limit: 50}}},
	}
	ModelDailyLimit = map[string]map[string]int{
		"claude-y": {"default": 888},
		"gemini-z": {"default": 777},
	}

	// 命中共享组时段
	w := resolveModelLimitWindowLocked("gpt-x", "default", bjTime(10, 0))
	if !w.Found || !w.InSupply || w.Limit != 100 || w.CounterName != modelDailyLimitSharedCounterPrefix+"sharedA" {
		t.Fatalf("shared time slot: %+v", w)
	}
	if w.ResetHour != -1 || w.WindowStart.Hour() != 8 || w.WindowEnd.Hour() != 16 {
		t.Fatalf("shared time slot window details: %+v", w)
	}

	// 共享组时段未命中 -> 暂停供应（即使有整日 Limits 也不回退）
	w = resolveModelLimitWindowLocked("gpt-x", "default", bjTime(20, 0))
	if !w.Found || w.InSupply {
		t.Fatalf("shared time slot miss should pause supply: %+v", w)
	}

	// 单模型时段覆盖整日
	w = resolveModelLimitWindowLocked("claude-y", "default", bjTime(3, 0))
	if !w.Found || !w.InSupply || w.Limit != 50 || w.CounterName != "claude-y" || w.ResetHour != -1 {
		t.Fatalf("model time slot: %+v", w)
	}
	// 单模型时段未命中 -> 暂停供应
	w = resolveModelLimitWindowLocked("claude-y", "default", bjTime(10, 0))
	if !w.Found || w.InSupply {
		t.Fatalf("model time slot miss should pause supply: %+v", w)
	}

	// 无时段模型走整日
	w = resolveModelLimitWindowLocked("gemini-z", "default", bjTime(10, 0))
	if !w.Found || !w.InSupply || w.Limit != 777 || w.ResetHour != 0 {
		t.Fatalf("plain daily limit: %+v", w)
	}

	// 未配置
	w = resolveModelLimitWindowLocked("unknown", "default", bjTime(10, 0))
	if w.Found {
		t.Fatalf("unconfigured model should not be found: %+v", w)
	}
}

// 时段校验：重叠检测、边界值
func TestCheckTimeSlots(t *testing.T) {
	// 合法：用户需求的经典三分段 24-8 8-16 16-24
	valid := []ModelTimeSlotLimit{
		{Start: 0, End: 8, Limit: 100},
		{Start: 8, End: 16, Limit: 200},
		{Start: 16, End: 24, Limit: 300},
	}
	if err := checkTimeSlots("m/default", valid); err != nil {
		t.Fatalf("valid slots rejected: %v", err)
	}

	// 合法：跨夜时段 + 白天时段
	validOvernight := []ModelTimeSlotLimit{
		{Start: 22, End: 6, Limit: 50},
		{Start: 8, End: 16, Limit: 100},
	}
	if err := checkTimeSlots("m/default", validOvernight); err != nil {
		t.Fatalf("valid overnight slots rejected: %v", err)
	}

	// 合法：limit=0 表示暂停供应
	paused := []ModelTimeSlotLimit{
		{Start: 0, End: 8, Limit: 0},
		{Start: 8, End: 24, Limit: 100},
	}
	if err := checkTimeSlots("m/default", paused); err != nil {
		t.Fatalf("paused slot rejected: %v", err)
	}

	// 重叠：8-16 与 15-24
	overlap := []ModelTimeSlotLimit{
		{Start: 8, End: 16, Limit: 100},
		{Start: 15, End: 24, Limit: 100},
	}
	if err := checkTimeSlots("m/default", overlap); err == nil {
		t.Fatal("overlapping slots should be rejected")
	}

	// 跨夜重叠：22-6 与 5-10
	overnightOverlap := []ModelTimeSlotLimit{
		{Start: 22, End: 6, Limit: 50},
		{Start: 5, End: 10, Limit: 100},
	}
	if err := checkTimeSlots("m/default", overnightOverlap); err == nil {
		t.Fatal("overlapping overnight slots should be rejected")
	}

	// 越界
	badRange := []ModelTimeSlotLimit{{Start: 25, End: 24, Limit: 1}}
	if err := checkTimeSlots("m/default", badRange); err == nil {
		t.Fatal("out-of-range hours should be rejected")
	}
}

// CheckModelTimeSlotLimits JSON 入口校验
func TestCheckModelTimeSlotLimitsJSON(t *testing.T) {
	if err := CheckModelTimeSlotLimits(""); err != nil {
		t.Fatalf("empty should pass: %v", err)
	}
	if err := CheckModelTimeSlotLimits(`{"gpt-x":{"default":[{"start":0,"end":8,"limit":100}]}}`); err != nil {
		t.Fatalf("valid json rejected: %v", err)
	}
	if err := CheckModelTimeSlotLimits(`{"gpt-x":{"default":[{"start":0,"end":0,"limit":100}]}}`); err != nil {
		t.Fatalf("all-day slot rejected: %v", err)
	}
	if err := CheckModelTimeSlotLimits(`{"":{"default":[{"start":0,"end":8,"limit":100}]}}`); err == nil {
		t.Fatal("empty model name should be rejected")
	}
}

// 共享组 JSON 校验含时段
func TestCheckModelDailyLimitGroupsWithTimeSlots(t *testing.T) {
	jsonStr := `[{"name":"a","models":["m1"],"limits":{},"time_slots":{"default":[{"start":8,"end":16,"limit":100}]}}]`
	if err := CheckModelDailyLimitGroups(jsonStr); err != nil {
		t.Fatalf("group with time slots rejected: %v", err)
	}
	badStr := `[{"name":"a","models":["m1"],"limits":{},"time_slots":{"default":[{"start":8,"end":16,"limit":100},{"start":10,"end":20,"limit":100}]}}]`
	if err := CheckModelDailyLimitGroups(badStr); err == nil {
		t.Fatal("overlapping time slots in group should be rejected")
	}
}
