package controller

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// checkCodeExecutionViolation 判定本次请求是否在非豁免分组中真实执行了代码。
// 命中则累计违规次数，达到阈值后写入用户级全局限速。
//
// 豁免规则：分组命中 CodeExecRateLimitExemptGroups（默认 coding）时不计数，
// 因为该分组本就允许无限制执行代码。限速本身是全局的——一旦触发，
// 该用户在包括 coding 在内的所有分组都会被限速。
func checkCodeExecutionViolation(c *gin.Context, relayInfo *relaycommon.RelayInfo, request dto.Request) {
	if relayInfo == nil || request == nil {
		return
	}
	group := modelDailyLimitGroup(relayInfo)
	if operation_setting.IsCodeExecRateLimitExemptGroup(group) {
		return
	}
	calls := service.DetectCodeExecution(request)
	if len(calls) == 0 {
		return
	}
	service.RegisterCodeExecViolation(relayInfo.UserId, group, relayInfo.OriginModelName, calls)
}
