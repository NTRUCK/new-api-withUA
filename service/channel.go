package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
)

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("通道「%s」（#%d）发生错误，准备禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, common.LocalLogPreview(reason)))

	// 检查是否启用自动禁用功能
	if !channelError.AutoBan {
		common.SysLog(fmt.Sprintf("通道「%s」（#%d）未启用自动禁用功能，跳过禁用操作", channelError.ChannelName, channelError.ChannelId))
		return
	}

	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

func ShouldDisableChannel(err *types.NewAPIError) bool {
	if !common.AutomaticDisableChannelEnabled {
		return false
	}
	if err == nil {
		return false
	}
	if err.GetErrorCode() == types.ErrorCodeConcurrencyLimitExceeded {
		return false
	}
	if types.IsChannelError(err) {
		return true
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if operation_setting.ShouldDisableByStatusCode(err.StatusCode) {
		return true
	}

	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, operation_setting.AutomaticDisableKeywords, true)
	return search
}

// ShouldDisableMultiKeyByQuota 判断该错误是否表示「上游这一把密钥额度/计费不足」。
// 命中时只禁用多 Key 渠道中报错的单把密钥，避免后续轮询继续选中它反复报错。
func ShouldDisableMultiKeyByQuota(err *types.NewAPIError) bool {
	if !operation_setting.MultiKeyQuotaDisableEnabled {
		return false
	}
	if err == nil {
		return false
	}
	if operation_setting.ShouldDisableMultiKeyByStatusCode(err.StatusCode) {
		return true
	}
	if len(operation_setting.MultiKeyQuotaDisableKeywords) == 0 {
		return false
	}
	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, operation_setting.MultiKeyQuotaDisableKeywords, true)
	return search
}

// DisableMultiKeyByQuota 禁用多 Key 渠道中额度/计费不足的那一把密钥，并标记禁用类型。
// 返回是否实际执行了禁用。channel 可为仅含 Id/Name 的轻量副本（如来自 context），
// 是否多 Key 由 model 层按渠道 ID 重新确认。
func DisableMultiKeyByQuota(channel *model.Channel, keyIndex int, usingKey string, reason string) bool {
	if channel == nil || channel.Id <= 0 {
		return false
	}
	if !model.DisableMultiKeyByIndex(channel.Id, keyIndex, usingKey, reason, model.MultiKeyDisabledCodeQuotaExhausted) {
		return false
	}
	common.SysLog(fmt.Sprintf(
		"多密钥渠道「%s」（#%d）已自动禁用额度不足的密钥 #%d，原因：%s",
		channel.Name, channel.Id, keyIndex+1, common.LocalLogPreview(reason),
	))
	return true
}

func ShouldEnableChannel(newAPIError *types.NewAPIError, status int) bool {
	if !common.AutomaticEnableChannelEnabled {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	return true
}
