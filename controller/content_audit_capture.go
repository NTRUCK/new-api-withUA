package controller

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ===== 内容审计：响应捕获与落库 =====

// auditResponseRecorder 包装 gin.ResponseWriter，把写出的响应体（明文，
// 位于 gzip writer 之前）缓存到内存上限，供内容审计记录。
// 超长时保留「头部 + 尾部」，避免丢失回复结尾。
type auditResponseRecorder struct {
	gin.ResponseWriter
	head      *bytes.Buffer
	tail      *bytes.Buffer
	headLimit int
	tailLimit int
	truncated bool
}

func newAuditResponseRecorder(w gin.ResponseWriter, limit int) *auditResponseRecorder {
	if limit <= 0 {
		limit = 4096
	}
	headLimit := limit * 3 / 4
	return &auditResponseRecorder{
		ResponseWriter: w,
		head:           &bytes.Buffer{},
		tail:           &bytes.Buffer{},
		headLimit:      headLimit,
		tailLimit:      limit - headLimit,
	}
}

func (w *auditResponseRecorder) writeChunk(b []byte) {
	if len(b) == 0 {
		return
	}
	if free := w.headLimit - w.head.Len(); free > 0 {
		if len(b) <= free {
			w.head.Write(b)
			return
		}
		w.head.Write(b[:free])
		b = b[free:]
	}
	w.truncated = true
	if w.tailLimit <= 0 {
		return
	}
	w.tail.Write(b)
	// 尾部滚动保留：丢弃最旧数据，始终保留最近的 tailLimit 字节
	if excess := w.tail.Len() - w.tailLimit; excess > 0 {
		w.tail.Next(excess)
	}
}

func (w *auditResponseRecorder) Write(b []byte) (int, error) {
	w.writeChunk(b)
	// 必须继续向下游写出，否则客户端收不到响应
	return w.ResponseWriter.Write(b)
}

func (w *auditResponseRecorder) WriteString(s string) (int, error) {
	w.writeChunk([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *auditResponseRecorder) snapshot() string {
	if w.head == nil {
		return ""
	}
	if !w.truncated {
		return w.head.String()
	}
	return w.head.String() + "\n\n...[响应过长，已省略中间部分]...\n\n" + w.tail.String()
}

// clipBody 超长时保留「头部 + 尾部」，避免丢失请求体末尾的最新用户消息。
func clipBody(s string, limit int) string {
	if limit <= 0 || len(s) <= limit {
		return s
	}
	head := limit * 6 / 10
	tail := limit - head
	marker := fmt.Sprintf("\n\n...[内容过长，已截断 %d 字节，保留首尾]...\n\n", len(s)-limit)
	return s[:head] + marker + s[len(s)-tail:]
}

// extractAssistantText 从响应原文（SSE 或普通 JSON）中提取助手输出文本。
// 覆盖 [OI] chat、Anthropic messages、Gemini、Responses 四种常见结构；
// 无法识别时返回空串（调用方保留原始响应体）。
func extractAssistantText(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "{") {
		return extractTextFromJSON(trimmed)
	}
	if !strings.Contains(trimmed, "data:") {
		return ""
	}
	var sb strings.Builder
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		sb.WriteString(extractTextFromJSON(payload))
	}
	return sb.String()
}

func extractTextFromJSON(payload string) string {
	var obj map[string]interface{}
	if err := common.UnmarshalJsonStr(payload, &obj); err != nil {
		return ""
	}
	var sb strings.Builder
	// [OI] chat completions（流式 delta / 非流式 message）
	if choices, ok := obj["choices"].([]interface{}); ok && len(choices) > 0 {
		if c0, ok := choices[0].(map[string]interface{}); ok {
			if d, ok := c0["delta"].(map[string]interface{}); ok {
				sb.WriteString(asString(d["content"]))
				sb.WriteString(asString(d["reasoning_content"]))
			}
			if m, ok := c0["message"].(map[string]interface{}); ok {
				sb.WriteString(asString(m["content"]))
				sb.WriteString(asString(m["reasoning_content"]))
			}
			sb.WriteString(asString(c0["text"]))
		}
	}
	// Anthropic 流式：content_block_delta.delta.text / delta(字符串)
	if d, ok := obj["delta"].(map[string]interface{}); ok {
		sb.WriteString(asString(d["text"]))
	} else {
		sb.WriteString(asString(obj["delta"]))
	}
	if cb, ok := obj["content_block"].(map[string]interface{}); ok {
		sb.WriteString(asString(cb["text"]))
	}
	// Responses API 非流式
	sb.WriteString(asString(obj["output_text"]))
	// Gemini：candidates[0].content.parts[].text
	if cands, ok := obj["candidates"].([]interface{}); ok && len(cands) > 0 {
		if c0, ok := cands[0].(map[string]interface{}); ok {
			if content, ok := c0["content"].(map[string]interface{}); ok {
				if parts, ok := content["parts"].([]interface{}); ok {
					for _, p := range parts {
						if pm, ok := p.(map[string]interface{}); ok {
							sb.WriteString(asString(pm["text"]))
						}
					}
				}
			}
		}
	}
	return sb.String()
}

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// recordContentAudit 命中审计白名单时，异步落库完整请求体、原始响应体与可读回复文本。
// 在 relay 结束（成功或失败）时调用，BodyStorage 仍可用（外层中间件尚未清理）。
func recordContentAudit(c *gin.Context, relayInfo *relaycommon.RelayInfo, rec *auditResponseRecorder, userId int, relayErr *types.NewAPIError) {
	if rec == nil || relayInfo == nil {
		return
	}
	// 读取缓存的请求体（仅取内存中已有数据，不触发额外读取）
	reqBody := ""
	if storage, err := common.GetBodyStorage(c); err == nil && storage != nil {
		if b, berr := storage.Bytes(); berr == nil {
			reqBody = string(b)
		}
	}
	maxBody := operation_setting.GetContentAuditMaxBodyBytes()
	reqBody = clipBody(reqBody, maxBody)
	rawResp := clipBody(rec.snapshot(), maxBody)
	errPreview := ""
	if relayErr != nil {
		errPreview = common.LocalLogPreview(relayErr.Error())
	}
	durationMs := 0
	if start := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime); !start.IsZero() {
		durationMs = int(time.Since(start).Milliseconds())
	}
	entry := &model.BodyLog{
		CreatedAt:        common.GetTimestamp(),
		UserId:           userId,
		Username:         c.GetString("username"),
		TokenId:          relayInfo.TokenId,
		TokenName:        c.GetString("token_name"),
		GroupName:        modelDailyLimitGroup(relayInfo),
		ModelName:        relayInfo.OriginModelName,
		ChannelId:        c.GetInt("channel_id"),
		UserAgent:        c.Request.UserAgent(),
		ClientIp:         c.ClientIP(),
		PromptTokens:     relayInfo.GetEstimatePromptTokens(),
		CompletionTokens: 0,
		DurationMs:       durationMs,
		RequestBody:      reqBody,
		ResponseBody:     rawResp,
		StatusCode:       c.Writer.Status(),
		ErrorPreview:     errPreview,
	}
	// 解析助手输出文本，附加在响应体尾部便于面板直接阅读（原始体仍完整保留）
	assistantText := extractAssistantText(rawResp)
	if assistantText != "" {
		entry.ResponseBody = clipBody(rawResp+"\n\n----- assistant_text -----\n"+assistantText, maxBody)
		entry.CompletionTokens = len(assistantText) / 4
	}
	gopool.Go(func() {
		defer func() {
			if r := recover(); r != nil {
				common.SysError("content audit insert panic: " + fmt.Sprint(r))
			}
		}()
		if err := model.InsertBodyLog(entry); err != nil {
			common.SysError("content audit insert failed: " + err.Error())
			return
		}
		model.CleanupBodyLogsIfNeeded(false)
		model.CheckAuditCapacity(false)
	})
}

// initContentAuditRecorder 在 relay 入口按白名单决定是否启用捕获。
func initContentAuditRecorder(c *gin.Context, relayInfo *relaycommon.RelayInfo) *auditResponseRecorder {
	userId := c.GetInt("id")
	if !operation_setting.ContentAuditMatches(userId, modelDailyLimitGroup(relayInfo)) {
		return nil
	}
	rec := newAuditResponseRecorder(c.Writer, operation_setting.GetContentAuditMaxBodyBytes())
	c.Writer = rec
	return rec
}
