package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError("failed to close response body: " + err.Error())
	}
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. It returns false for Content-Length
// (managed separately) and X-Oneapi-Request-Id (to preserve the local instance
// ID). When the upstream header is X-Oneapi-Request-Id, the value is captured
// into the Gin context for later logging.
func ShouldCopyUpstreamHeader(c *gin.Context, k string, v []string) bool {
	if c != nil && common.GetContextKeyBool(c, constant.ContextKeyHideUpstreamInfo) {
		lowerKey := strings.ToLower(k)
		if strings.Contains(lowerKey, "model") || strings.HasPrefix(lowerKey, "x-upstream-") || strings.HasPrefix(lowerKey, "openai-") || strings.HasPrefix(lowerKey, "anthropic-") {
			return false
		}
	}
	if strings.EqualFold(k, "Content-Length") {
		return false
	}
	if strings.EqualFold(k, common.RequestIdKey) {
		if c != nil && len(v) > 0 {
			c.Set(common.UpstreamRequestIdKey, v[0])
		}
		return false
	}
	return true
}

func sanitizeUpstreamResponseBody(c *gin.Context, data []byte) []byte {
	if c == nil || !common.GetContextKeyBool(c, constant.ContextKeyHideUpstreamInfo) || !gjson.ValidBytes(data) {
		return data
	}
	modelName := common.GetContextKeyString(c, constant.ContextKeyPublicModelName)
	if modelName == "" {
		return data
	}
	result, err := sjson.SetBytes(data, "model", modelName)
	if err != nil {
		return data
	}
	for _, path := range []string{"message.model", "response.model", "data.model"} {
		if gjson.GetBytes(result, path).Exists() {
			result, _ = sjson.SetBytes(result, path, modelName)
		}
	}
	for _, path := range []string{"system_fingerprint", "message.system_fingerprint", "response.system_fingerprint", "data.system_fingerprint"} {
		result, _ = sjson.DeleteBytes(result, path)
	}
	return result
}

func IOCopyBytesGracefully(c *gin.Context, src *http.Response, data []byte) {
	if c.Writer == nil {
		return
	}

	data = sanitizeUpstreamResponseBody(c, data)
	body := io.NopCloser(bytes.NewBuffer(data))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the httpClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	if src != nil {
		for k, v := range src.Header {
			if !ShouldCopyUpstreamHeader(c, k, v) {
				continue
			}
			c.Writer.Header().Set(k, v[0])
		}
	}

	// set Content-Length header manually BEFORE calling WriteHeader
	c.Writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	// Write header with status code (this sends the headers)
	if src != nil {
		c.Writer.WriteHeader(src.StatusCode)
	} else {
		c.Writer.WriteHeader(http.StatusOK)
	}

	_, err := io.Copy(c.Writer, body)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
