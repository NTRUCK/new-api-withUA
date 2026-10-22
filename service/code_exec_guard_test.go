package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

func TestDetectOpenAICodeExec(t *testing.T) {
	// 真实：assistant 发起 run_command，tool 回环结果
	real := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{Role: "user", Content: "跑一下 ls"},
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"call_1","type":"function","function":{"name":"run_command","arguments":"{\"cmd\":\"ls\"}"}}]`),
			},
			{Role: "tool", ToolCallId: "call_1", Content: "a.txt"},
		},
	}
	if hits := DetectCodeExecution(real); len(hits) != 1 || hits["call_1"] != "run_command" {
		t.Fatalf("real code exec not detected: %v", hits)
	}

	// 酒馆预设：只声明 tools，没有 role=tool 回环
	tavern := &dto.GeneralOpenAIRequest{
		Tools: []dto.ToolCallRequest{
			{Type: "function", Function: dto.FunctionRequest{Name: "Write"}},
			{Type: "function", Function: dto.FunctionRequest{Name: "CreateLorebook"}},
		},
		Messages: []dto.Message{
			{Role: "user", Content: "写一段故事"},
			{Role: "assistant", Content: "好"},
		},
	}
	if hits := DetectCodeExecution(tavern); len(hits) != 0 {
		t.Fatalf("tavern preset should not be detected: %v", hits)
	}

	// 只读类工具 + 回环：不计入
	readOnly := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"call_2","type":"function","function":{"name":"read_file","arguments":"{}"}}]`),
			},
			{Role: "tool", ToolCallId: "call_2", Content: "file content"},
		},
	}
	if hits := DetectCodeExecution(readOnly); len(hits) != 0 {
		t.Fatalf("read-only tool should not be detected: %v", hits)
	}

	// 辅助工具 + 回环（get_time_info / save_memory）：不计入
	aux := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"c3","type":"function","function":{"name":"get_time_info","arguments":"{}"}},{"id":"c4","type":"function","function":{"name":"save_memory","arguments":"{}"}}]`),
			},
			{Role: "tool", ToolCallId: "c3", Content: "2026-10-05"},
			{Role: "tool", ToolCallId: "c4", Content: "Memory saved"},
		},
	}
	if hits := DetectCodeExecution(aux); len(hits) != 0 {
		t.Fatalf("aux tools should not be detected: %v", hits)
	}

	// tool_call_id 无法回溯（伪造回环）：不计入
	forged := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"a1","type":"function","function":{"name":"run_command","arguments":"{}"}}]`),
			},
			{Role: "tool", ToolCallId: "b2", Content: "x"},
		},
	}
	if hits := DetectCodeExecution(forged); len(hits) != 0 {
		t.Fatalf("unclosed tool_call_id should not be detected: %v", hits)
	}
}

func TestDetectClaudeCodeExec(t *testing.T) {
	req := &dto.ClaudeRequest{
		Messages: []dto.ClaudeMessage{
			{
				Role: "assistant",
				Content: []any{
					map[string]any{"type": "tool_use", "id": "toolu_1", "name": "bash", "input": map[string]any{"cmd": "ls"}},
				},
			},
			{
				Role: "user",
				Content: []any{
					map[string]any{"type": "tool_result", "tool_use_id": "toolu_1", "content": "ok"},
				},
			},
		},
	}
	hits := DetectCodeExecution(req)
	if len(hits) != 1 || hits["toolu_1"] != "bash" {
		t.Fatalf("claude code exec not detected: %v", hits)
	}

	// 无回环
	noResult := &dto.ClaudeRequest{
		Messages: []dto.ClaudeMessage{
			{
				Role: "assistant",
				Content: []any{
					map[string]any{"type": "tool_use", "id": "toolu_2", "name": "bash"},
				},
			},
		},
	}
	if hits := DetectCodeExecution(noResult); len(hits) != 0 {
		t.Fatalf("claude without tool_result should not be detected: %v", hits)
	}
}

func TestDetectResponsesCodeExec(t *testing.T) {
	input := `[
		{"type":"function_call","call_id":"fc_1","name":"write_file","arguments":"{}"},
		{"type":"function_call_output","call_id":"fc_1","output":"done"}
	]`
	req := &dto.OpenAIResponsesRequest{Input: []byte(input)}
	hits := DetectCodeExecution(req)
	if len(hits) != 1 || hits["fc_1"] != "write_file" {
		t.Fatalf("responses code exec not detected: %v", hits)
	}

	onlyCall := &dto.OpenAIResponsesRequest{Input: []byte(`[{"type":"function_call","call_id":"fc_2","name":"write_file"}]`)}
	if hits := DetectCodeExecution(onlyCall); len(hits) != 0 {
		t.Fatalf("responses without output should not be detected: %v", hits)
	}
}
