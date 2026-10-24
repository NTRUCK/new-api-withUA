package system_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// DiscordGuildRule 单条服务器准入规则：校验用户是否为指定服务器成员，
// 若配置 RoleId 则进一步要求持有该身份组（为空则仅校验成员身份）。
type DiscordGuildRule struct {
	GuildId string `json:"guild_id"` // Discord 服务器 ID
	RoleId  string `json:"role_id"`  // 可选：要求的身份组 ID
}

// DiscordGuildRuleGroup 一个准入组：组内所有规则必须全部满足（AND）。
type DiscordGuildRuleGroup []DiscordGuildRule

// DiscordGuildRuleGroups 准入组列表：组之间按 any/all 匹配。
// 兼容历史平铺格式 [{...}]：此时每条规则视为一个只含单条规则的组，
// 使改造前后的 any/all 语义保持一致。
type DiscordGuildRuleGroups []DiscordGuildRuleGroup

func (g *DiscordGuildRuleGroups) UnmarshalJSON(data []byte) error {
	var groups []DiscordGuildRuleGroup
	if err := common.Unmarshal(data, &groups); err == nil {
		*g = groups
		return nil
	}
	var flat []DiscordGuildRule
	if err := common.Unmarshal(data, &flat); err != nil {
		return err
	}
	converted := make(DiscordGuildRuleGroups, 0, len(flat))
	for _, rule := range flat {
		converted = append(converted, DiscordGuildRuleGroup{rule})
	}
	*g = converted
	return nil
}

// DiscordRoleGroupRule 身份组到用户组的映射：新用户注册时按命中的最高优先级规则定组。
type DiscordRoleGroupRule struct {
	GuildId  string `json:"guild_id"` // Discord 服务器 ID
	RoleId   string `json:"role_id"`  // 身份组 ID；为空表示该服务器任意成员
	Group    string `json:"group"`    // 目标用户组
	Priority int    `json:"priority"` // 优先级，数字越大越优先
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
	// 每个组内的规则须全部满足，组之间按 GuildRulesMatch 决定任一/全部。
	GuildRules      DiscordGuildRuleGroups `json:"guild_rules"`       // 服务器+身份组准入组列表
	GuildRulesMatch string                 `json:"guild_rules_match"` // any=满足任一组 / all=全部组均需满足
	// 邀请码专属准入：配置后，新用户注册只能通过 Discord OAuth 完成，
	// 且必须通过其中规则（叠加在全局服务器准入之上）。为空则不启用。
	AffGuildRules      DiscordGuildRuleGroups `json:"aff_guild_rules"`       // 邀请注册专属的服务器+身份组准入组
	AffGuildRulesMatch string                 `json:"aff_guild_rules_match"` // any=满足任一组 / all=全部组均需满足
	// 注册分组：仅在新用户注册时按 Discord 身份组分配用户组，
	// 多条命中取 Priority 最大者；启用后未命中任何规则将拒绝注册。
	RoleGroupEnabled bool                   `json:"role_group_enabled"` // 是否启用注册时按身份组分配用户组
	RoleGroupRules   []DiscordRoleGroupRule `json:"role_group_rules"`   // 身份组 -> 用户组映射
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

// GetGuildRules 返回有效的多服务器准入组（过滤掉未填服务器 ID 的条目与空组）
func (s *DiscordSettings) GetGuildRules() DiscordGuildRuleGroups {
	return filterGuildRuleGroups(s.GuildRules)
}

// GetAffGuildRules 返回邀请码专属的服务器准入组（过滤掉未填服务器 ID 的条目与空组）
func (s *DiscordSettings) GetAffGuildRules() DiscordGuildRuleGroups {
	return filterGuildRuleGroups(s.AffGuildRules)
}

// GetRoleGroupRules 返回有效的身份组映射（过滤掉未填服务器 ID 或目标用户组的条目）
func (s *DiscordSettings) GetRoleGroupRules() []DiscordRoleGroupRule {
	valid := make([]DiscordRoleGroupRule, 0, len(s.RoleGroupRules))
	for _, rule := range s.RoleGroupRules {
		if strings.TrimSpace(rule.GuildId) == "" || strings.TrimSpace(rule.Group) == "" {
			continue
		}
		valid = append(valid, rule)
	}
	return valid
}

func filterGuildRuleGroups(groups []DiscordGuildRuleGroup) DiscordGuildRuleGroups {
	valid := make(DiscordGuildRuleGroups, 0, len(groups))
	for _, group := range groups {
		cleaned := make(DiscordGuildRuleGroup, 0, len(group))
		for _, rule := range group {
			if strings.TrimSpace(rule.GuildId) != "" {
				cleaned = append(cleaned, rule)
			}
		}
		if len(cleaned) > 0 {
			valid = append(valid, cleaned)
		}
	}
	return valid
}

// IsGuildRulesMatchAll 是否要求全部准入组均满足（默认满足任一组即可）
func (s *DiscordSettings) IsGuildRulesMatchAll() bool {
	return strings.TrimSpace(s.GuildRulesMatch) == "all"
}

// IsAffGuildRulesMatchAll 邀请码专属准入是否要求全部准入组均满足（默认满足任一组即可）
func (s *DiscordSettings) IsAffGuildRulesMatchAll() bool {
	return strings.TrimSpace(s.AffGuildRulesMatch) == "all"
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
