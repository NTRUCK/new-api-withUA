package helper

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestSanitizePublicResponseJSON(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	common.SetContextKey(c, constant.ContextKeyHideUpstreamInfo, true)
	common.SetContextKey(c, constant.ContextKeyPublicModelName, "public-model")

	result := SanitizePublicResponseJSON(c, []byte(`{"id":"chatcmpl-1","model":"upstream-model","system_fingerprint":"fp_123","choices":[]}`))
	require.Equal(t, "public-model", gjson.GetBytes(result, "model").String())
	require.False(t, gjson.GetBytes(result, "system_fingerprint").Exists())
	require.Equal(t, "chatcmpl-1", gjson.GetBytes(result, "id").String())
}

func TestSanitizePublicResponseJSONDisabled(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	input := []byte(`{"model":"upstream-model","system_fingerprint":"fp_123"}`)
	require.Equal(t, input, SanitizePublicResponseJSON(c, input))
}
