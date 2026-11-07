package service

import "testing"

func TestCalibrateChannelInputTokens(t *testing.T) {
	const (
		insufficientChannel = 900001
		underOneChannel     = 900002
		overOneChannel      = 900003
	)

	// 样本不足时不做校准
	ObserveChannelInputCalibration(insufficientChannel, 20000, 24000)
	ObserveChannelInputCalibration(insufficientChannel, 20000, 24000)
	if got := CalibrateChannelInputTokens(insufficientChannel, 20000); got != 20000 {
		t.Fatalf("样本不足时不应校准, got %d want 20000", got)
	}

	// 上游系统性低于本地估算时保持原值
	for i := 0; i < 3; i++ {
		ObserveChannelInputCalibration(underOneChannel, 100000, 90000)
	}
	if got := CalibrateChannelInputTokens(underOneChannel, 100000); got != 100000 {
		t.Fatalf("上游低于本地估算时不应放大, got %d want 100000", got)
	}

	// 上游系统性高于本地估算时按比值放大
	for i := 0; i < 3; i++ {
		ObserveChannelInputCalibration(overOneChannel, 100000, 120000)
	}
	ratio, samples := ChannelInputCalibrationRatio(overOneChannel)
	if samples != 3 {
		t.Fatalf("样本数应为 3, got %d", samples)
	}
	if ratio < 1.15 || ratio > 1.25 {
		t.Fatalf("比值应接近 1.2, got %f", ratio)
	}
	got := CalibrateChannelInputTokens(overOneChannel, 100000)
	if got < 115000 || got > 125000 {
		t.Fatalf("校准值应接近 120000, got %d", got)
	}
}

func TestCalibrateChannelInputTokensIgnoresSmallSamples(t *testing.T) {
	const channelId = 900010
	// 小请求的上游固定注入会把比值放大到几十倍，必须被忽略
	for i := 0; i < 5; i++ {
		ObserveChannelInputCalibration(channelId, 100, 4000)
	}
	ratio, samples := ChannelInputCalibrationRatio(channelId)
	if samples != 0 || ratio != 0 {
		t.Fatalf("小样本不应参与统计, got ratio=%f samples=%d", ratio, samples)
	}
	if got := CalibrateChannelInputTokens(channelId, 100); got != 100 {
		t.Fatalf("got %d want 100", got)
	}
}

func TestCalibrateChannelInputTokensClampsRatio(t *testing.T) {
	const channelId = 900011
	// 上游统计异常放大时比值被限制在 3 倍以内
	for i := 0; i < 3; i++ {
		ObserveChannelInputCalibration(channelId, 20000, 80000)
	}
	ratio, _ := ChannelInputCalibrationRatio(channelId)
	if ratio > channelInputCalibrationMaxRatio {
		t.Fatalf("比值应被限制在 %f 以内, got %f", channelInputCalibrationMaxRatio, ratio)
	}
}
