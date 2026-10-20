package relay

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ===== 纯文本模式（无视觉）=====
// 渠道开启 text_only_input 后，请求在上游看来就是纯文本请求：
// 图片 / 音频 / 文件 / 视频 part 全部丢弃，content 降级为纯字符串。
// 某条消息剥离后若没有文本，整条消息删除；若整个请求被清空，
// 回退为一条空文本消息，避免上游因 messages/content 为空而报错。

// StripTextOnlyChatRequest 剥离 [OI] Chat Completions 请求中的非文本内容。
func StripTextOnlyChatRequest(req *dto.GeneralOpenAIRequest) {
	if req == nil {
		return
	}
	messages := make([]dto.Message, 0, len(req.Messages))
	for _, msg := range req.Messages {
		if msg.IsStringContent() {
			messages = append(messages, msg)
			continue
		}
		parts := msg.ParseContent()
		if len(parts) == 0 {
			messages = append(messages, msg)
			continue
		}
		texts := make([]string, 0, len(parts))
		changed := false
		for _, part := range parts {
			if part.Type == dto.ContentTypeText {
				texts = append(texts, part.Text)
				continue
			}
			changed = true
		}
		if !changed {
			messages = append(messages, msg)
			continue
		}
		if len(texts) == 0 {
			continue
		}
		msg.SetStringContent(strings.Join(texts, ""))
		messages = append(messages, msg)
	}
	if len(messages) == 0 {
		messages = append(messages, dto.Message{Role: "user", Content: ""})
	}
	req.Messages = messages
}

// StripTextOnlyClaudeRequest 剥离 Claude Messages 请求中的非文本 block。
func StripTextOnlyClaudeRequest(req *dto.ClaudeRequest) {
	if req == nil {
		return
	}
	if req.System != nil {
		if cleaned, changed := stripClaudeBlocks(req.System); changed {
			req.System = cleaned
		}
	}
	messages := make([]dto.ClaudeMessage, 0, len(req.Messages))
	for _, msg := range req.Messages {
		if msg.IsStringContent() {
			messages = append(messages, msg)
			continue
		}
		cleaned, changed := stripClaudeBlocks(msg.Content)
		if !changed {
			messages = append(messages, msg)
			continue
		}
		if blocks, ok := cleaned.([]dto.ClaudeMediaMessage); ok && len(blocks) == 0 {
			continue
		}
		msg.Content = cleaned
		messages = append(messages, msg)
	}
	if len(messages) == 0 {
		messages = append(messages, dto.ClaudeMessage{Role: "user", Content: ""})
	}
	req.Messages = messages
}

// stripClaudeBlocks 过滤 Claude content block：删除 image/document/video，
// 并递归清理 tool_result 内嵌的图片。返回清理后的 content 与是否发生变更。
func stripClaudeBlocks(content any) (any, bool) {
	blocks, ok := content.([]dto.ClaudeMediaMessage)
	if !ok {
		// 可能是 []any（未经类型化解析），尝试转换
		if raw, err := common.Marshal(content); err == nil {
			if err = common.Unmarshal(raw, &blocks); err != nil {
				return content, false
			}
		} else {
			return content, false
		}
	}
	kept := make([]dto.ClaudeMediaMessage, 0, len(blocks))
	changed := false
	for _, block := range blocks {
		switch block.Type {
		case "image", "document", "video":
			changed = true
			continue
		case "tool_result":
			if block.Content == nil {
				kept = append(kept, block)
				continue
			}
			cleaned, subChanged := stripClaudeBlocks(block.Content)
			if subChanged {
				block.Content = cleaned
				changed = true
			}
			kept = append(kept, block)
			continue
		}
		kept = append(kept, block)
	}
	if !changed {
		return content, false
	}
	return kept, true
}

// StripTextOnlyGeminiRequest 剥离 Gemini 请求中的内联媒体与文件引用。
func StripTextOnlyGeminiRequest(req *dto.GeminiChatRequest) {
	if req == nil {
		return
	}
	if req.SystemInstructions != nil {
		req.SystemInstructions.Parts = filterGeminiTextParts(req.SystemInstructions.Parts)
	}
	contents := make([]dto.GeminiChatContent, 0, len(req.Contents))
	for _, content := range req.Contents {
		parts := filterGeminiTextParts(content.Parts)
		if len(parts) == 0 {
			continue
		}
		content.Parts = parts
		contents = append(contents, content)
	}
	if len(contents) == 0 {
		contents = append(contents, dto.GeminiChatContent{
			Role:  "user",
			Parts: []dto.GeminiPart{{Text: ""}},
		})
	}
	req.Contents = contents
}

// filterGeminiTextParts 仅保留文本与函数调用相关的 part。
func filterGeminiTextParts(parts []dto.GeminiPart) []dto.GeminiPart {
	if len(parts) == 0 {
		return parts
	}
	kept := make([]dto.GeminiPart, 0, len(parts))
	for _, part := range parts {
		if part.InlineData != nil || part.FileData != nil {
			continue
		}
		kept = append(kept, part)
	}
	return kept
}

// StripTextOnlyResponsesRequest 剥离 Responses API 请求中的图片/文件输入。
func StripTextOnlyResponsesRequest(req *dto.OpenAIResponsesRequest) {
	if req == nil {
		return
	}
	if len(req.Input) > 0 {
		if cleaned, changed := stripResponsesContent(req.Input); changed {
			req.Input = cleaned
		}
	}
	if len(req.Instructions) > 0 {
		if cleaned, changed := stripResponsesContent(req.Instructions); changed {
			req.Instructions = cleaned
		}
	}
}

// stripResponsesContent 处理 Responses 的 input/instructions：
// 顶层数组删除 input_image/input_file/input_video 项，并递归清理 message 的 content 数组。
func stripResponsesContent(raw json.RawMessage) (json.RawMessage, bool) {
	if common.GetJsonType(raw) != "array" {
		return raw, false
	}
	var items []json.RawMessage
	if err := common.Unmarshal(raw, &items); err != nil {
		return raw, false
	}
	kept := make([]json.RawMessage, 0, len(items))
	changed := false
	for _, item := range items {
		var obj map[string]any
		if err := common.Unmarshal(item, &obj); err != nil {
			kept = append(kept, item)
			continue
		}
		switch obj["type"] {
		case "input_image", "input_file", "input_video":
			changed = true
			continue
		}
		if content, ok := obj["content"]; ok {
			contentRaw, err := common.Marshal(content)
			if err == nil {
				if cleaned, subChanged := stripResponsesContent(contentRaw); subChanged {
					var cleanedVal any
					if common.Unmarshal(cleaned, &cleanedVal) == nil {
						obj["content"] = cleanedVal
						if rebuilt, mErr := common.Marshal(obj); mErr == nil {
							item = rebuilt
						}
						changed = true
					}
				}
			}
		}
		kept = append(kept, item)
	}
	if !changed {
		return raw, false
	}
	if len(kept) == 0 {
		return json.RawMessage(`""`), true
	}
	out, err := common.Marshal(kept)
	if err != nil {
		return raw, false
	}
	return out, true
}
