package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type DiscordSettings struct {
	Enabled      bool   `json:"enabled"`
	ClientId     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	// 服务器准入（单服务器）：每次登录/注册校验用户是否为指定服务器成员，
	// 可选进一步要求持有指定身份组。
	GuildGating bool   `json:"guild_gating"` // 是否启用服务器准入校验
	GuildId     string `json:"guild_id"`     // 限定的 Discord 服务器 ID
	RequireRole bool   `json:"require_role"` // 是否要求持有指定身份组
	RoleId      string `json:"role_id"`      // 指定身份组 ID（require_role=true 时生效）
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
