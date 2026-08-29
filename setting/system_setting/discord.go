package system_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// DiscordGuildRule 单条服务器准入规则：校验用户是否为指定服务器成员，
// 若配置 RoleId 则进一步要求持有该身份组（为空则仅校验成员身份）。
type DiscordGuildRule struct {
	GuildId string `json:"guild_id"` // Discord 服务器 ID
	RoleId  string `json:"role_id"`  // 可选：要求的身份组 ID
}

type DiscordSettings struct {
	Enabled      bool   `json:"enabled"`
	ClientId     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	// 服务器准入（单服务器）：每次登录/注册校验用户是否为指定服务器成员，
	// 可选进一步要求持有指定身份组。
	GuildGating            bool   `json:"guild_gating"`             // 是否启用服务器准入校验
	GuildId                string `json:"guild_id"`                 // 限定的 Discord 服务器 ID
	RequireRole            bool   `json:"require_role"`             // 是否要求持有指定身份组
	RoleId                 string `json:"role_id"`                  // 指定身份组 ID（require_role=true 时生效）
	RegisterLimitWhitelist string `json:"register_limit_whitelist"` // 满员时仍可注册的 Discord 用户 ID
	// 服务器准入（多服务器）：配置后优先生效，忽略上方单服务器配置。
	GuildRules      []DiscordGuildRule `json:"guild_rules"`       // 服务器+身份组规则列表
	GuildRulesMatch string             `json:"guild_rules_match"` // any=满足任一规则 / all=全部规则均需满足
}

// 默认配置
var defaultDiscordSettings = DiscordSettings{}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("discord", &defaultDiscordSettings)
}

func GetDiscordSettings() *DiscordSettings {
	return &defaultDiscordSettings
}

// GetGuildRules 返回有效的多服务器准入规则（过滤掉未填服务器 ID 的条目）
func (s *DiscordSettings) GetGuildRules() []DiscordGuildRule {
	rules := make([]DiscordGuildRule, 0, len(s.GuildRules))
	for _, rule := range s.GuildRules {
		if strings.TrimSpace(rule.GuildId) != "" {
			rules = append(rules, rule)
		}
	}
	return rules
}

// IsGuildRulesMatchAll 是否要求全部规则均满足（默认满足任一即可）
func (s *DiscordSettings) IsGuildRulesMatchAll() bool {
	return strings.TrimSpace(s.GuildRulesMatch) == "all"
}

func IsDiscordRegisterLimitWhitelisted(discordId string) bool {
	discordId = strings.TrimSpace(discordId)
	if discordId == "" {
		return false
	}
	for _, configuredId := range strings.Split(defaultDiscordSettings.RegisterLimitWhitelist, "\n") {
		if strings.TrimSpace(configuredId) == discordId {
			return true
		}
	}
	return false
}
