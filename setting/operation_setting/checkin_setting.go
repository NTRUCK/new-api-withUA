package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// CheckinTier 签到额度梯度档位
// 当用户「当前剩余额度」>= MinBalance 时命中该档，奖励为 [MinQuota, MaxQuota] 随机
type CheckinTier struct {
	MinBalance int `json:"min_balance"` // 命中该档所需的最小剩余额度（quota 单位）
	MinQuota   int `json:"min_quota"`   // 该档奖励最小额度
	MaxQuota   int `json:"max_quota"`   // 该档奖励最大额度
}

// CheckinSetting 签到功能配置
type CheckinSetting struct {
	Enabled  bool          `json:"enabled"`   // 是否启用签到功能
	MinQuota int           `json:"min_quota"` // 默认签到最小额度奖励（未命中任何梯度档时使用）
	MaxQuota int           `json:"max_quota"` // 默认签到最大额度奖励（未命中任何梯度档时使用）
	Tiers    []CheckinTier `json:"tiers"`     // 自定义梯度档位（按剩余额度从高到低匹配）
}

// 默认配置
var checkinSetting = CheckinSetting{
	Enabled:  false,           // 默认关闭
	MinQuota: 1000,            // 默认最小额度 1000 (约 0.002 USD)
	MaxQuota: 10000,           // 默认最大额度 10000 (约 0.02 USD)
	Tiers:    []CheckinTier{}, // 默认无梯度
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("checkin_setting", &checkinSetting)
}

// GetCheckinSetting 获取签到配置
func GetCheckinSetting() *CheckinSetting {
	return &checkinSetting
}

// IsCheckinEnabled 是否启用签到功能
func IsCheckinEnabled() bool {
	return checkinSetting.Enabled
}

// GetCheckinQuotaRange 获取签到额度范围
func GetCheckinQuotaRange() (min, max int) {
	return checkinSetting.MinQuota, checkinSetting.MaxQuota
}

// GetCheckinQuotaRangeByBalance 根据用户当前剩余额度返回适用的签到额度范围。
// 按梯度档 MinBalance 从高到低匹配，命中第一个 balance >= MinBalance 的档；
// 未命中任何档时返回默认的 MinQuota/MaxQuota。
func GetCheckinQuotaRangeByBalance(balance int) (min, max int) {
	bestIdx := -1
	bestThreshold := -1
	for i, tier := range checkinSetting.Tiers {
		if tier.MinQuota < 0 || tier.MaxQuota < 0 {
			continue
		}
		if balance >= tier.MinBalance && tier.MinBalance > bestThreshold {
			bestThreshold = tier.MinBalance
			bestIdx = i
		}
	}
	if bestIdx >= 0 {
		return checkinSetting.Tiers[bestIdx].MinQuota, checkinSetting.Tiers[bestIdx].MaxQuota
	}
	return checkinSetting.MinQuota, checkinSetting.MaxQuota
}
