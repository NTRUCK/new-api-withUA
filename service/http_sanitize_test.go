package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestSanitizeUpstreamResponseBody(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	common.SetContextKey(c, constant.ContextKeyHideUpstreamInfo, true)
	common.SetContextKey(c, constant.ContextKeyPublicModelName, "public-model")

	result := sanitizeUpstreamResponseBody(c, []byte(`{"model":"upstream-model","system_fingerprint":"fp","choices":[]}`))
	require.Equal(t, "public-model", gjson.GetBytes(result, "model").String())
	require.False(t, gjson.GetBytes(result, "system_fingerprint").Exists())
}

func TestShouldCopyUpstreamHeaderWhenHidden(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	common.SetContextKey(c, constant.ContextKeyHideUpstreamInfo, true)
	require.False(t, ShouldCopyUpstreamHeader(c, "X-Upstream-Model", []string{"secret"}))
	require.False(t, ShouldCopyUpstreamHeader(c, "OpenAI-Model", []string{"secret"}))
	require.True(t, ShouldCopyUpstreamHeader(c, "Content-Type", []string{"application/json"}))
}
