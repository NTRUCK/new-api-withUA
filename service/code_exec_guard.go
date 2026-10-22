package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// ===== 代码执行风控 =====
//
// 目标：在非 coding 分组中真实执行代码（命令行 / 文件写入）的用户，
// 累计达到阈值后对其做全局限速（RPM + 并发），不封号，管理员可解除。
//
// 判定依据只有一条可靠信号：role=tool 消息的 tool_call_id 能对应到
// 同一请求中 assistant.tool_calls[].id，即「工具结果真的回传过」。
// 酒馆预设只把工具声明塞进 tools 字段、从不产生 role=tool 回环，
// 因此天然被闭环条件排除，无需维护预设黑名单。

const (
	// CodeExecViolationWindow 违规计数与去重集合的滑动窗口
	CodeExecViolationWindow = 24 * time.Hour
	// CodeExecRateLimitDuration 触发后的限速持续时间
	CodeExecRateLimitDuration = 24 * time.Hour
	// CodeExecRateLimitRpm 触发后写入的每分钟请求上限
	CodeExecRateLimitRpm = 1
	// CodeExecRateLimitConcurrency 触发后生效的并发上限
	CodeExecRateLimitConcurrency = 1
	// NotifyTypeCodeExecRateLimit 代码执行自动限速通知类型
	NotifyTypeCodeExecRateLimit = "code_exec_rate_limit"
)

// codeExecToolNames 会真正落地执行的工具名（命令执行 / 文件写入）。
// 只读检索类（Read/Glob/Grep/list_files/read_file）不计入，
// 时间、记忆、联网搜索等辅助工具同样不计入。
var codeExecToolNames = map[string]struct{}{
	"run_command":             {},
	"bash":                    {},
	"shell":                   {},
	"execute_bash":            {},
	"execute_python":          {},
	"execute_code":            {},
	"code_execution":          {},
	"run_code":                {},
	"run_terminal_cmd":        {},
	"terminal":                {},
	"write_file":              {},
	"create_file":             {},
	"append_file":             {},
	"edit_file":               {},
	"apply_patch":             {},
	"str_replace_editor":      {},
	"str_replace":             {},
	"multi_edit":              {},
	"create_download":         {},
	"Bash":                    {},
	"Write":                   {},
	"Edit":                    {},
	"astrbot_execute_python":  {},
	"astrbot_execute_shell":   {},
	"astrbot_file_write_tool": {},
	"astrbot_file_edit_tool":  {},
	"astrbot_shell_session":   {},
}

func isCodeExecTool(name string) bool {
	_, ok := codeExecToolNames[name]
	return ok
}

// DetectCodeExecution 返回本次请求中「已闭环」的代码执行调用：callId -> 工具名。
// 未命中返回 nil。只判定同一请求内 tool_call_id 能回溯到调用方 id 的调用。
func DetectCodeExecution(req dto.Request) map[string]string {
	switch r := req.(type) {
	case *dto.GeneralOpenAIRequest:
		return detectOpenAICodeExec(r)
	case *dto.ClaudeRequest:
		return detectClaudeCodeExec(r)
	case *dto.OpenAIResponsesRequest:
		return detectResponsesCodeExec(r)
	}
	return nil
}

func detectOpenAICodeExec(req *dto.GeneralOpenAIRequest) map[string]string {
	calls := make(map[string]string)
	for i := range req.Messages {
		msg := &req.Messages[i]
		if msg.Role != "assistant" || len(msg.ToolCalls) == 0 {
			continue
		}
		var declared []dto.ToolCallRequest
		if err := common.Unmarshal(msg.ToolCalls, &declared); err != nil {
			continue
		}
		for _, c := range declared {
			if c.ID != "" && c.Function.Name != "" {
				calls[c.ID] = c.Function.Name
			}
		}
	}
	if len(calls) == 0 {
		return nil
	}
	hits := make(map[string]string)
	for i := range req.Messages {
		msg := &req.Messages[i]
		if msg.Role != "tool" || msg.ToolCallId == "" {
			continue
		}
		if name, ok := calls[msg.ToolCallId]; ok && isCodeExecTool(name) {
			hits[msg.ToolCallId] = name
		}
	}
	if len(hits) == 0 {
		return nil
	}
	return hits
}

func detectClaudeCodeExec(req *dto.ClaudeRequest) map[string]string {
	calls := make(map[string]string)
	resultIds := make([]string, 0, 8)
	for i := range req.Messages {
		items, ok := req.Messages[i].Content.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			switch common.Interface2String(block["type"]) {
			case "tool_use":
				id := common.Interface2String(block["id"])
				name := common.Interface2String(block["name"])
				if id != "" && name != "" {
					calls[id] = name
				}
			case "tool_result":
				if id := common.Interface2String(block["tool_use_id"]); id != "" {
					resultIds = append(resultIds, id)
				}
			}
		}
	}
	if len(calls) == 0 {
		return nil
	}
	hits := make(map[string]string)
	for _, id := range resultIds {
		if name, ok := calls[id]; ok && isCodeExecTool(name) {
			hits[id] = name
		}
	}
	if len(hits) == 0 {
		return nil
	}
	return hits
}

func detectResponsesCodeExec(req *dto.OpenAIResponsesRequest) map[string]string {
	if len(req.Input) == 0 {
		return nil
	}
	var items []map[string]any
	if err := common.Unmarshal(req.Input, &items); err != nil {
		return nil
	}
	calls := make(map[string]string)
	resultIds := make([]string, 0, 8)
	for _, item := range items {
		switch common.Interface2String(item["type"]) {
		case "function_call":
			callId := common.Interface2String(item["call_id"])
			name := common.Interface2String(item["name"])
			if callId != "" && name != "" {
				calls[callId] = name
			}
		case "function_call_output":
			if callId := common.Interface2String(item["call_id"]); callId != "" {
				resultIds = append(resultIds, callId)
			}
		}
	}
	if len(calls) == 0 {
		return nil
	}
	hits := make(map[string]string)
	for _, id := range resultIds {
		if name, ok := calls[id]; ok && isCodeExecTool(name) {
			hits[id] = name
		}
	}
	if len(hits) == 0 {
		return nil
	}
	return hits
}

var codeExecViolationScript = `
local fresh = 0
for i = 1, #ARGV - 1 do
    local added = redis.call('SADD', KEYS[1], ARGV[i])
    if added == 1 then fresh = fresh + 1 end
end
redis.call('EXPIRE', KEYS[1], ARGV[#ARGV])
if fresh > 0 then
    redis.call('INCR', KEYS[2])
    redis.call('EXPIRE', KEYS[2], ARGV[#ARGV])
end
return tonumber(redis.call('GET', KEYS[2]) or '0')
`

// codeExecState 内存兜底状态（Redis 不可用时使用）
type codeExecState struct {
	count     int
	seen      map[string]struct{}
	expiresAt time.Time
}

var (
	codeExecMu    sync.Mutex
	codeExecStore = make(map[int]*codeExecState)
)

// RegisterCodeExecViolation 记录一次代码执行违规，累计达到阈值后写入用户级限速。
// calls 为「已闭环的代码执行调用」callId -> 工具名；同一 callId 在窗口内只计一次，
// 避免 agent 客户端携带完整历史导致每次都重复计数。返回是否在本次触发了限速。
func RegisterCodeExecViolation(userId int, group, modelName string, calls map[string]string) bool {
	if userId <= 0 || len(calls) == 0 {
		return false
	}
	threshold := operation_setting.CodeExecRateLimitThreshold
	if threshold < 1 {
		threshold = 3
	}
	ids := make([]string, 0, len(calls))
	for id := range calls {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	count, ok := incrCodeExecViolation(userId, ids)
	if !ok || count < threshold {
		return false
	}

	until := time.Now().Add(CodeExecRateLimitDuration).Unix()
	if err := model.SetUserRateLimit(userId, CodeExecRateLimitRpm, until); err != nil {
		common.SysLog(fmt.Sprintf("failed to set rate limit for user %d: %s", userId, err.Error()))
		return false
	}
	resetCodeExecViolation(userId)

	sample := make([]string, 0, 3)
	for _, id := range ids {
		sample = append(sample, fmt.Sprintf("%s[%s]", calls[id], id))
		if len(sample) >= 3 {
			break
		}
	}
	subject := "用户因在非 coding 分组执行代码被自动限速"
	content := fmt.Sprintf(
		"用户 ID %d 在分组「%s」累计 %d 次真实代码执行（模型 %s），已自动限速：RPM %d、并发 %d，持续 %s。\n最近调用：%s",
		userId, group, count, modelName, CodeExecRateLimitRpm, CodeExecRateLimitConcurrency,
		CodeExecRateLimitDuration.String(), strings.Join(sample, ", "),
	)
	NotifyRootUser(NotifyTypeCodeExecRateLimit, subject, content)
	model.RecordLogWithAdminInfo(userId, model.LogTypeManage,
		fmt.Sprintf("用户因在非 coding 分组执行代码累计 %d 次被自动限速（RPM %d / 并发 %d）",
			count, CodeExecRateLimitRpm, CodeExecRateLimitConcurrency),
		map[string]interface{}{
			"group":      group,
			"model":      modelName,
			"count":      count,
			"rpm":        CodeExecRateLimitRpm,
			"concurrency": CodeExecRateLimitConcurrency,
			"until":      until,
			"calls":      sample,
		})
	return true
}

// incrCodeExecViolation 累计违规次数。ids 中只要出现新 id 就把计数 +1；
// 全部是已见过的 id 时返回当前计数不变。
func incrCodeExecViolation(userId int, ids []string) (int, bool) {
	if common.RedisEnabled && common.RDB != nil {
		seenKey := fmt.Sprintf("code_exec_seen:%d", userId)
		countKey := fmt.Sprintf("code_exec_violation:%d", userId)
		args := make([]interface{}, 0, len(ids)+1)
		for _, id := range ids {
			args = append(args, id)
		}
		args = append(args, int(CodeExecViolationWindow/time.Second))
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		result, err := common.RDB.Eval(ctx, codeExecViolationScript, []string{seenKey, countKey}, args...).Int()
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to record code exec violation for user %d: %s", userId, err.Error()))
			return 0, false
		}
		return result, true
	}

	now := time.Now()
	codeExecMu.Lock()
	defer codeExecMu.Unlock()
	st, ok := codeExecStore[userId]
	if !ok || now.After(st.expiresAt) {
		st = &codeExecState{seen: make(map[string]struct{}), expiresAt: now.Add(CodeExecViolationWindow)}
		codeExecStore[userId] = st
	}
	fresh := 0
	for _, id := range ids {
		if _, exists := st.seen[id]; exists {
			continue
		}
		st.seen[id] = struct{}{}
		fresh++
	}
	if fresh > 0 {
		st.count += fresh
	}
	return st.count, true
}

func resetCodeExecViolation(userId int) {
	if common.RedisEnabled && common.RDB != nil {
		_ = common.RedisDelKey(fmt.Sprintf("code_exec_seen:%d", userId))
		_ = common.RedisDelKey(fmt.Sprintf("code_exec_violation:%d", userId))
		return
	}
	codeExecMu.Lock()
	defer codeExecMu.Unlock()
	delete(codeExecStore, userId)
}

// GetUserRiskRateLimitRpm 返回用户当前生效的风控 RPM 上限，0 表示未受限。
func GetUserRiskRateLimitRpm(userId int) int {
	if userId <= 0 {
		return 0
	}
	userCache, err := model.GetUserCache(userId)
	if err != nil || userCache == nil {
		return 0
	}
	if userCache.RateLimitUntil <= time.Now().Unix() {
		return 0
	}
	return userCache.RateLimitRpm
}
