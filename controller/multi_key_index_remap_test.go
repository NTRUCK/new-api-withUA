package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

// newMultiKeyTestChannel 构造一个多密钥渠道，按 oldKeys 写入状态数据。
func newMultiKeyTestChannel(oldKeys []string) *model.Channel {
	channel := &model.Channel{
		Key: joinKeys(oldKeys),
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeySize:       len(oldKeys),
			MultiKeyStatusList: map[int]int{0: common.ChannelStatusAutoDisabled, 2: 2},
			MultiKeyDisabledReason: map[int]string{
				0: "key 1 quota exhausted",
				2: "key 3 manual disabled",
			},
			MultiKeyDisabledCode: map[int]string{0: model.MultiKeyDisabledCodeQuotaExhausted},
			MultiKeyDisabledTime: map[int]int64{0: 100, 2: 300},
			MultiKeyErrorLog: map[int][]model.KeyErrorLog{
				0: {{Time: 100, StatusCode: 429, Message: "rate limited"}},
				2: {{Time: 300, StatusCode: 401, Message: "unauthorized"}},
			},
		},
	}
	channel.SetSetting(dto.ChannelSettings{KeyProxies: map[int]string{0: "socks5://p1", 2: "socks5://p3"}})
	return channel
}

func joinKeys(keys []string) string {
	out := ""
	for i, k := range keys {
		if i > 0 {
			out += "\n"
		}
		out += k
	}
	return out
}

// 覆盖模式：第 1 把被替换，它的报错历史不能跟到新密钥上。
func TestRemapMultiKeyIndexStateReplaceDropsStaleState(t *testing.T) {
	oldKeys := []string{"key-a", "key-b", "key-c"}
	channel := newMultiKeyTestChannel(oldKeys)

	// 覆盖为新列表：第 1 把换了，其余两把不变
	channel.Key = joinKeys([]string{"key-a", "key-new", "key-c"})
	remapMultiKeyIndexState(channel, oldKeys)

	// 未变动的 key-a / key-c 状态保留并保持索引
	require.Equal(t, common.ChannelStatusAutoDisabled, channel.ChannelInfo.MultiKeyStatusList[0])
	require.Equal(t, 2, channel.ChannelInfo.MultiKeyStatusList[2])
	require.Equal(t, "key 3 manual disabled", channel.ChannelInfo.MultiKeyDisabledReason[2])
	require.Equal(t, int64(300), channel.ChannelInfo.MultiKeyDisabledTime[2])
	require.Len(t, channel.ChannelInfo.MultiKeyErrorLog[2], 1)

	// 被替换的第 1 把必须彻底干净
	_, hasStatus := channel.ChannelInfo.MultiKeyStatusList[1]
	require.False(t, hasStatus)
	_, hasReason := channel.ChannelInfo.MultiKeyDisabledReason[1]
	require.False(t, hasReason)
	_, hasCode := channel.ChannelInfo.MultiKeyDisabledCode[1]
	require.False(t, hasCode)
	_, hasLog := channel.ChannelInfo.MultiKeyErrorLog[1]
	require.False(t, hasLog)

	// key 专属代理跟随密钥，被替换位置的代理应被清除
	setting := channel.GetSetting()
	require.Equal(t, "socks5://p1", setting.KeyProxies[0])
	require.Equal(t, "socks5://p3", setting.KeyProxies[2])
	_, hasProxy := setting.KeyProxies[1]
	require.False(t, hasProxy)
}

// 追加模式：新密钥插在中间时，后续密钥的状态必须跟随密钥本身而不是索引。
func TestRemapMultiKeyIndexStateAppendFollowsKeyNotIndex(t *testing.T) {
	oldKeys := []string{"key-a", "key-b", "key-c"}
	channel := newMultiKeyTestChannel(oldKeys)

	// 追加后顺序变化：key-a, key-new, key-b, key-c
	channel.Key = joinKeys([]string{"key-a", "key-new", "key-b", "key-c"})
	remapMultiKeyIndexState(channel, oldKeys)

	// key-a 仍在 0
	require.Equal(t, common.ChannelStatusAutoDisabled, channel.ChannelInfo.MultiKeyStatusList[0])
	// key-c 从索引 2 移到索引 3，状态要跟着走
	require.Equal(t, 2, channel.ChannelInfo.MultiKeyStatusList[3])
	require.Equal(t, "key 3 manual disabled", channel.ChannelInfo.MultiKeyDisabledReason[3])
	require.Equal(t, int64(300), channel.ChannelInfo.MultiKeyDisabledTime[3])
	// key-b 原本没有状态，迁移到索引 2 后也不应有状态
	_, hasStatus := channel.ChannelInfo.MultiKeyStatusList[2]
	require.False(t, hasStatus)
	// 新增的 key-new 在索引 1，不能继承任何状态
	_, hasStatus = channel.ChannelInfo.MultiKeyStatusList[1]
	require.False(t, hasStatus)
	_, hasLog := channel.ChannelInfo.MultiKeyErrorLog[1]
	require.False(t, hasLog)

	// 代理同样跟随密钥
	setting := channel.GetSetting()
	require.Equal(t, "socks5://p3", setting.KeyProxies[3])
	_, hasProxy := setting.KeyProxies[1]
	require.False(t, hasProxy)
}

// 整组替换：全部旧状态清空，轮询索引归零。
func TestRemapMultiKeyIndexStateReplaceAll(t *testing.T) {
	oldKeys := []string{"key-a", "key-b", "key-c"}
	channel := newMultiKeyTestChannel(oldKeys)
	channel.ChannelInfo.MultiKeyPollingIndex = 2

	channel.Key = joinKeys([]string{"new-1", "new-2"})
	remapMultiKeyIndexState(channel, oldKeys)

	require.Empty(t, channel.ChannelInfo.MultiKeyStatusList)
	require.Empty(t, channel.ChannelInfo.MultiKeyDisabledReason)
	require.Empty(t, channel.ChannelInfo.MultiKeyDisabledCode)
	require.Empty(t, channel.ChannelInfo.MultiKeyDisabledTime)
	require.Empty(t, channel.ChannelInfo.MultiKeyErrorLog)
	require.Equal(t, 0, channel.ChannelInfo.MultiKeyPollingIndex)

	setting := channel.GetSetting()
	require.Empty(t, setting.KeyProxies)
}

// 重复密钥：旧列表里同一个 key 出现多次时按顺序取用，不会互相覆盖。
func TestRemapMultiKeyIndexStateDuplicateKeys(t *testing.T) {
	oldKeys := []string{"dup", "key-b", "dup"}
	channel := newMultiKeyTestChannel(oldKeys)
	channel.ChannelInfo.MultiKeyStatusList = map[int]int{0: 2, 2: common.ChannelStatusAutoDisabled}

	channel.Key = joinKeys([]string{"dup", "dup"})
	remapMultiKeyIndexState(channel, oldKeys)

	require.Equal(t, 2, channel.ChannelInfo.MultiKeyStatusList[0])
	require.Equal(t, common.ChannelStatusAutoDisabled, channel.ChannelInfo.MultiKeyStatusList[1])
}
