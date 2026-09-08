package constant

type MultiKeyMode string

const (
	MultiKeyModeRandom    MultiKeyMode = "random"    // 随机
	MultiKeyModePolling   MultiKeyMode = "polling"   // 轮询
	MultiKeyModeSequential MultiKeyMode = "sequential" // 依次耗尽：固定用第一个可用key，被禁用(401/403等)后自动切换下一个
)
