package service

import "sync"

// ===== 渠道输入 token 校准 =====
//
// 渠道级「最大输入 token」限制只能在请求发出前用本地估算值判定，
// 而上游（尤其是反代 / 号池渠道）往往会在请求上叠加自己的 system prompt、
// 工具定义等内容，导致上游统计的 prompt_tokens 系统性高于本地估算。
// 若直接拿本地估算和上限比较，实际送达上游的输入可能已明显超出配置值。
//
// 做法：按渠道维护「上游 prompt_tokens / 本地估算」的指数滑动平均，
// 判定时用它放大本地估算（只放大不缩小），让判定口径更贴近上游真实值。
// 只采集足够大的样本，避免小请求里占比极高的固定注入把比值放大几十倍。

const (
	// channelInputCalibrationMinSample 低于该估算值的样本不参与统计，
	// 因为上游固定注入在小请求里占比过高，会把比值放大到无意义的量级。
	channelInputCalibrationMinSample = 10000
	// channelInputCalibrationAlpha 指数滑动平均系数。
	channelInputCalibrationAlpha = 0.3
	// channelInputCalibrationMinSamples 至少积累这么多样本才启用校准。
	channelInputCalibrationMinSamples = 3
	// channelInputCalibrationMaxRatio 比值上限，避免异常上游把判定放大到误拦正常请求。
	channelInputCalibrationMaxRatio = 3.0
)

type channelInputCalibration struct {
	ratio   float64
	samples int
}

var (
	channelInputCalibrationLock sync.RWMutex
	channelInputCalibrations    = make(map[int]*channelInputCalibration)
)

// ObserveChannelInputCalibration 记录一次「本地估算 vs 上游实际」样本。
func ObserveChannelInputCalibration(channelId, estimate, upstreamPromptTokens int) {
	if channelId <= 0 || estimate < channelInputCalibrationMinSample || upstreamPromptTokens <= 0 {
		return
	}
	ratio := float64(upstreamPromptTokens) / float64(estimate)
	// 明显异常（上游统计缺失、口径突变、缓存重复计算）不采信
	if ratio < 0.5 || ratio > 5 {
		return
	}
	if ratio > channelInputCalibrationMaxRatio {
		ratio = channelInputCalibrationMaxRatio
	}

	channelInputCalibrationLock.Lock()
	defer channelInputCalibrationLock.Unlock()
	state, ok := channelInputCalibrations[channelId]
	if !ok {
		channelInputCalibrations[channelId] = &channelInputCalibration{ratio: ratio, samples: 1}
		return
	}
	state.ratio = state.ratio*(1-channelInputCalibrationAlpha) + ratio*channelInputCalibrationAlpha
	state.samples++
}

// CalibrateChannelInputTokens 把本地估算换算成更接近上游真实值的输入 token 数。
// 未积累足够样本、或上游系统性低于本地估算时，原样返回。
func CalibrateChannelInputTokens(channelId, estimate int) int {
	if channelId <= 0 || estimate <= 0 {
		return estimate
	}
	channelInputCalibrationLock.RLock()
	state, ok := channelInputCalibrations[channelId]
	var ratio float64
	if ok && state.samples >= channelInputCalibrationMinSamples {
		ratio = state.ratio
	}
	channelInputCalibrationLock.RUnlock()

	if ratio <= 1 {
		return estimate
	}
	calibrated := int(float64(estimate) * ratio)
	if calibrated <= estimate {
		return estimate
	}
	return calibrated
}

// ChannelInputCalibrationRatio 返回渠道当前的校准比值与样本数，用于排查。
func ChannelInputCalibrationRatio(channelId int) (float64, int) {
	channelInputCalibrationLock.RLock()
	defer channelInputCalibrationLock.RUnlock()
	state, ok := channelInputCalibrations[channelId]
	if !ok {
		return 0, 0
	}
	return state.ratio, state.samples
}
