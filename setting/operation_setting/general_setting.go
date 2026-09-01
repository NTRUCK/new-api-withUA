package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// 额度展示类型
const (
	QuotaDisplayTypeUSD    = "USD"
	QuotaDisplayTypeCNY    = "CNY"
	QuotaDisplayTypeTokens = "TOKENS"
	QuotaDisplayTypeCustom = "CUSTOM"
)

// CustomCurrency 预设自定义货币（管理员配置，成员可从中选择展示偏好）
type CustomCurrency struct {
	// 唯一标识（成员偏好存储引用此 key）
	Key string `json:"key"`
	// 显示名称
	Name string `json:"name"`
	// 货币符号
	Symbol string `json:"symbol"`
	// 1 USD = X 该货币
	RateToUSD float64 `json:"rate_to_usd"`
}

type GeneralSetting struct {
	DocsLink            string `json:"docs_link"`
	PingIntervalEnabled bool   `json:"ping_interval_enabled"`
	PingIntervalSeconds int    `json:"ping_interval_seconds"`
	// 当前站点额度展示类型：USD / CNY / TOKENS
	QuotaDisplayType string `json:"quota_display_type"`
	// 自定义货币符号，用于 CUSTOM 展示类型
	CustomCurrencySymbol string `json:"custom_currency_symbol"`
	// 自定义货币与美元汇率（1 USD = X Custom）
	CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`
	// 预设自定义货币列表：成员可在个人设置中选择展示货币，仅能从此列表选择
	CustomCurrencies []CustomCurrency `json:"custom_currencies"`
	// Discord 社区入口：开启后在页脚展示跳转链接
	DiscordEnabled bool   `json:"discord_enabled"`
	DiscordLink    string `json:"discord_link"`
}

// 默认配置
var generalSetting = GeneralSetting{
	DocsLink:                   "https://docs.newapi.pro",
	PingIntervalEnabled:        false,
	PingIntervalSeconds:        60,
	QuotaDisplayType:           QuotaDisplayTypeUSD,
	CustomCurrencySymbol:       "¤",
	CustomCurrencyExchangeRate: 1.0,
	DiscordEnabled:             false,
	DiscordLink:                "",
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("general_setting", &generalSetting)
}

// GetGeneralSetting 返回通用设置
func GetGeneralSetting() *GeneralSetting {
	return &generalSetting
}

// GetCustomCurrencies 返回预设自定义货币列表（过滤无效项）
func GetCustomCurrencies() []CustomCurrency {
	result := make([]CustomCurrency, 0, len(generalSetting.CustomCurrencies))
	for _, c := range generalSetting.CustomCurrencies {
		if c.Key != "" && c.Symbol != "" && c.RateToUSD > 0 {
			result = append(result, c)
		}
	}
	return result
}

// GetCustomCurrency 按 key 查找预设货币，不存在返回 nil
func GetCustomCurrency(key string) *CustomCurrency {
	if key == "" {
		return nil
	}
	for i, c := range generalSetting.CustomCurrencies {
		if c.Key == key && c.Symbol != "" && c.RateToUSD > 0 {
			return &generalSetting.CustomCurrencies[i]
		}
	}
	return nil
}

// IsCurrencyDisplay 是否以货币形式展示（美元或人民币）
func IsCurrencyDisplay() bool {
	return generalSetting.QuotaDisplayType != QuotaDisplayTypeTokens
}

// IsCNYDisplay 是否以人民币展示
func IsCNYDisplay() bool {
	return generalSetting.QuotaDisplayType == QuotaDisplayTypeCNY
}

// GetQuotaDisplayType 返回额度展示类型
func GetQuotaDisplayType() string {
	return generalSetting.QuotaDisplayType
}

// GetCurrencySymbol 返回当前展示类型对应符号
func GetCurrencySymbol() string {
	switch generalSetting.QuotaDisplayType {
	case QuotaDisplayTypeUSD:
		return "$"
	case QuotaDisplayTypeCNY:
		return "¥"
	case QuotaDisplayTypeCustom:
		if generalSetting.CustomCurrencySymbol != "" {
			return generalSetting.CustomCurrencySymbol
		}
		return "¤"
	default:
		return ""
	}
}

// GetUsdToCurrencyRate 返回 1 USD = X <currency> 的 X（TOKENS 不适用）
func GetUsdToCurrencyRate(usdToCny float64) float64 {
	switch generalSetting.QuotaDisplayType {
	case QuotaDisplayTypeUSD:
		return 1
	case QuotaDisplayTypeCNY:
		return usdToCny
	case QuotaDisplayTypeCustom:
		if generalSetting.CustomCurrencyExchangeRate > 0 {
			return generalSetting.CustomCurrencyExchangeRate
		}
		return 1
	default:
		return 1
	}
}
