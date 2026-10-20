package perfmetrics

import (
	"context"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/types"
)

type Outcome string

const (
	OutcomeSuccess Outcome = "success"
	OutcomeFailure Outcome = "failure"
	OutcomeIgnored Outcome = "ignored"
)

// ClassifyRelayFailure 判断一次失败的 relay 是否应计入模型健康样本。
// 业务拒绝（余额不足、参数错误、敏感词、内容过滤等）与客户端主动取消
// 不计入分母，否则会把「用户自己导致的问题」算成模型不可用。
func ClassifyRelayFailure(apiErr *types.NewAPIError) Outcome {
	if apiErr == nil {
		return OutcomeFailure
	}
	if errors.Is(apiErr, context.Canceled) {
		return OutcomeIgnored
	}
	root := rootAPIError(apiErr)
	code := strings.ToLower(string(root.GetErrorCode()))

	if root.GetErrorType() == types.ErrorTypeNewAPIError {
		switch types.ErrorCode(code) {
		case types.ErrorCodeInvalidRequest, types.ErrorCodeSensitiveWordsDetected,
			types.ErrorCodeReadRequestBodyFailed, types.ErrorCodeConvertRequestFailed,
			types.ErrorCodeAccessDenied, types.ErrorCodeBadRequestBody,
			types.ErrorCodeInsufficientUserQuota, types.ErrorCodePreConsumeTokenQuotaFailed,
			types.ErrorCodePromptBlocked:
			return OutcomeIgnored
		}
		return OutcomeFailure
	}

	// 上游明确返回的业务性错误同样不算模型故障。
	switch code {
	case "context_length_exceeded", "invalid_request", "invalid_request_error", "invalid_argument",
		"sensitive_words_detected", "prompt_blocked", "content_filter", "content_policy_violation", "safety":
		return OutcomeIgnored
	}
	if strings.HasPrefix(code, "violation_fee.") {
		return OutcomeIgnored
	}

	switch root.StatusCode {
	case 400, 405, 409, 413, 415, 422:
		return OutcomeIgnored
	}
	return OutcomeFailure
}

// rootAPIError 沿错误链找到真正描述上游行为的那个错误，
// 例如被重新包装成「本地请求非法」的上游凭证错误。
func rootAPIError(apiErr *types.NewAPIError) *types.NewAPIError {
	for {
		var inner *types.NewAPIError
		if !errors.As(apiErr.Unwrap(), &inner) || inner == apiErr {
			return apiErr
		}
		apiErr = inner
	}
}
