package relay

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

func TestStripTextOnlyChatRequest(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{Role: "user", Content: []any{
				map[string]any{"type": "text", "text": "这张图是什么"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
			}},
			{Role: "user", Content: []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/b.png"}},
			}},
			{Role: "assistant", Content: "纯文本回复"},
		},
	}
	StripTextOnlyChatRequest(req)
	if len(req.Messages) != 2 {
		t.Fatalf("expected 2 messages after strip, got %d", len(req.Messages))
	}
	if req.Messages[0].StringContent() != "这张图是什么" {
		t.Fatalf("unexpected first content: %q", req.Messages[0].StringContent())
	}
	if !req.Messages[0].IsStringContent() {
		t.Fatalf("first message should be downgraded to string content")
	}
}

func TestStripTextOnlyChatRequestAllMedia(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{Role: "user", Content: []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/c.png"}},
			}},
		},
	}
	StripTextOnlyChatRequest(req)
	if len(req.Messages) != 1 || req.Messages[0].StringContent() != "" {
		t.Fatalf("expected single empty text fallback, got %+v", req.Messages)
	}
}

func TestStripTextOnlyClaudeRequest(t *testing.T) {
	req := &dto.ClaudeRequest{
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: []dto.ClaudeMediaMessage{
				{Type: "text", Text: common.GetPointer("看图")},
				{Type: "image", Source: &dto.ClaudeMessageSource{Type: "base64", MediaType: "image/png", Data: "AAAA"}},
			}},
			{Role: "user", Content: []dto.ClaudeMediaMessage{
				{Type: "image", Source: &dto.ClaudeMessageSource{Type: "base64", MediaType: "image/png", Data: "BBBB"}},
			}},
		},
	}
	StripTextOnlyClaudeRequest(req)
	if len(req.Messages) != 1 {
		t.Fatalf("expected 1 message after strip, got %d", len(req.Messages))
	}
	blocks, err := req.Messages[0].ParseContent()
	if err != nil || len(blocks) != 1 || blocks[0].Type != "text" {
		t.Fatalf("unexpected blocks: %+v err=%v", blocks, err)
	}
}

func TestStripTextOnlyGeminiRequest(t *testing.T) {
	req := &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{Role: "user", Parts: []dto.GeminiPart{
				{Text: "看图"},
				{InlineData: &dto.GeminiInlineData{MimeType: "image/png", Data: "AAAA"}},
			}},
			{Role: "user", Parts: []dto.GeminiPart{
				{FileData: &dto.GeminiFileData{MimeType: "image/png", FileUri: "gs://x/y.png"}},
			}},
		},
	}
	StripTextOnlyGeminiRequest(req)
	if len(req.Contents) != 1 {
		t.Fatalf("expected 1 content after strip, got %d", len(req.Contents))
	}
	if len(req.Contents[0].Parts) != 1 || req.Contents[0].Parts[0].Text != "看图" {
		t.Fatalf("unexpected parts: %+v", req.Contents[0].Parts)
	}
}

func TestStripTextOnlyResponsesRequest(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{}
	_ = common.UnmarshalJsonStr(`{"input":[{"role":"user","content":[{"type":"input_text","text":"看图"},{"type":"input_image","image_url":"https://example.com/d.png"}]},{"type":"input_image","image_url":"https://example.com/e.png"}]}`, req)
	StripTextOnlyResponsesRequest(req)
	s := string(req.Input)
	if s == "" {
		t.Fatalf("input should not be empty")
	}
	if len(s) == 0 || strings.Contains(s, "input_image") {
		t.Fatalf("image parts should be stripped, got %s", s)
	}
	if !strings.Contains(s, "看图") {
		t.Fatalf("text part should be kept, got %s", s)
	}
}
