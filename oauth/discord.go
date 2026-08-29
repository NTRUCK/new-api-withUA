package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func init() {
	Register("discord", &DiscordProvider{})
}

// DiscordProvider implements OAuth for Discord
type DiscordProvider struct{}

type discordOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
}

type discordUser struct {
	UID    string `json:"id"`
	ID     string `json:"username"`
	Name   string `json:"global_name"`
	Avatar string `json:"avatar"`
}

func (p *DiscordProvider) GetName() string {
	return "Discord"
}

func (p *DiscordProvider) IsEnabled() bool {
	return system_setting.GetDiscordSettings().Enabled
}

func (p *DiscordProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*OAuthToken, error) {
	if code == "" {
		return nil, NewOAuthError(i18n.MsgOAuthInvalidCode, nil)
	}

	logger.LogDebug(ctx, "[OAuth-Discord] ExchangeToken: code=%s...", code[:min(len(code), 10)])

	settings := system_setting.GetDiscordSettings()
	redirectUri := fmt.Sprintf("%s/oauth/discord", system_setting.ServerAddress)
	values := url.Values{}
	values.Set("client_id", settings.ClientId)
	values.Set("client_secret", settings.ClientSecret)
	values.Set("code", code)
	values.Set("grant_type", "authorization_code")
	values.Set("redirect_uri", redirectUri)

	logger.LogDebug(ctx, "[OAuth-Discord] ExchangeToken: redirect_uri=%s", redirectUri)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://discord.com/api/v10/oauth2/token", strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := http.Client{
		Timeout: 5 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] ExchangeToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Discord"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Discord] ExchangeToken response status: %d", res.StatusCode)

	var discordResponse discordOAuthResponse
	err = json.NewDecoder(res.Body).Decode(&discordResponse)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] ExchangeToken decode error: %s", err.Error()))
		return nil, err
	}

	if discordResponse.AccessToken == "" {
		logger.LogError(ctx, "[OAuth-Discord] ExchangeToken failed: empty access token")
		return nil, NewOAuthError(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Discord"})
	}

	logger.LogDebug(ctx, "[OAuth-Discord] ExchangeToken success: scope=%s", discordResponse.Scope)

	return &OAuthToken{
		AccessToken:  discordResponse.AccessToken,
		TokenType:    discordResponse.TokenType,
		RefreshToken: discordResponse.RefreshToken,
		ExpiresIn:    discordResponse.ExpiresIn,
		Scope:        discordResponse.Scope,
		IDToken:      discordResponse.IDToken,
	}, nil
}

func (p *DiscordProvider) GetUserInfo(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	logger.LogDebug(ctx, "[OAuth-Discord] GetUserInfo: fetching user info")

	req, err := http.NewRequestWithContext(ctx, "GET", "https://discord.com/api/v10/users/@me", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)

	client := http.Client{
		Timeout: 5 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] GetUserInfo error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Discord"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Discord] GetUserInfo response status: %d", res.StatusCode)

	if res.StatusCode != http.StatusOK {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] GetUserInfo failed: status=%d", res.StatusCode))
		return nil, NewOAuthError(i18n.MsgOAuthGetUserErr, nil)
	}

	var discordUser discordUser
	err = json.NewDecoder(res.Body).Decode(&discordUser)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] GetUserInfo decode error: %s", err.Error()))
		return nil, err
	}

	if discordUser.UID == "" || discordUser.ID == "" {
		logger.LogError(ctx, "[OAuth-Discord] GetUserInfo failed: empty user fields")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "Discord"})
	}

	logger.LogDebug(ctx, "[OAuth-Discord] GetUserInfo success: uid=%s, username=%s, name=%s", discordUser.UID, discordUser.ID, discordUser.Name)

	return &OAuthUser{
		ProviderUserID: discordUser.UID,
		Username:       discordUser.ID,
		DisplayName:    discordUser.Name,
		Extra: map[string]any{
			"discord_username":    discordUser.ID,
			"discord_global_name": discordUser.Name,
			"discord_avatar":      discordUser.Avatar,
		},
	}, nil
}

func (p *DiscordProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsDiscordIdAlreadyTaken(providerUserID)
}

// discordGuildMember 为 GET /users/@me/guilds/{guild.id}/member 的部分响应
type discordGuildMember struct {
	Roles []string `json:"roles"`
	// 当非成员时，Discord 返回 { "code": ..., "message": ... }
	Code int `json:"code"`
}

// hasRole 判断成员是否持有指定身份组
func (m *discordGuildMember) hasRole(roleId string) bool {
	for _, r := range m.Roles {
		if r == roleId {
			return true
		}
	}
	return false
}

// fetchGuildMember 调 GET /users/@me/guilds/{guildId}/member 获取用户在某服务器的成员信息。
// 返回 nil, nil 表示用户不是该服务器成员；网络等错误返回 err。
func fetchGuildMember(ctx context.Context, accessToken, guildId string) (*discordGuildMember, error) {
	url := fmt.Sprintf("https://discord.com/api/v10/users/@me/guilds/%s/member", guildId)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] fetchGuildMember(%s) error: %s", guildId, err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Discord"}, err.Error())
	}
	defer res.Body.Close()

	// 非 200 视为非该服务器成员
	if res.StatusCode != http.StatusOK {
		logger.LogDebug(ctx, "[OAuth-Discord] fetchGuildMember(%s): user is not a guild member, status=%d", guildId, res.StatusCode)
		return nil, nil
	}

	var member discordGuildMember
	if err := common.DecodeJson(res.Body, &member); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Discord] fetchGuildMember(%s) decode error: %s", guildId, err.Error()))
		return nil, err
	}
	return &member, nil
}

// CheckGuildAccess 校验用户是否满足服务器准入要求：
//   - 未启用 GuildGating：直接放行
//   - 配置了多服务器规则（guild_rules）：按 any/all 模式校验，优先生效
//   - 否则回退单服务器逻辑：调 GET /users/@me/guilds/{guild_id}/member，
//     非成员则拒绝；RequireRole=true 时进一步要求持有指定 RoleId
//
// 需要 access token 具备 guilds.members.read scope。
func CheckGuildAccess(c *gin.Context, token *OAuthToken) error {
	settings := system_setting.GetDiscordSettings()
	if !settings.GuildGating {
		return nil
	}

	ctx := c.Request.Context()

	// 多服务器规则优先
	if rules := settings.GetGuildRules(); len(rules) > 0 {
		return checkGuildRules(c, token, rules, settings.IsGuildRulesMatchAll())
	}

	if settings.GuildId == "" {
		return nil
	}

	member, err := fetchGuildMember(ctx, token.AccessToken, settings.GuildId)
	if err != nil {
		return err
	}
	if member == nil {
		return &AccessDeniedError{Message: i18n.T(c, i18n.MsgOAuthDiscordNotGuildMember)}
	}

	if settings.RequireRole && settings.RoleId != "" && !member.hasRole(settings.RoleId) {
		logger.LogDebug(ctx, "[OAuth-Discord] CheckGuildAccess: user lacks required role %s", settings.RoleId)
		return &AccessDeniedError{Message: i18n.T(c, i18n.MsgOAuthDiscordMissingRole)}
	}

	return nil
}

// checkGuildRules 多服务器准入校验：
//   - matchAll=false：满足任一规则即放行（是成员且持有该规则要求的身份组，规则未配身份组则仅要求成员）
//   - matchAll=true：所有规则均需满足，任一不满足即拒绝并给出具体原因
func checkGuildRules(c *gin.Context, token *OAuthToken, rules []system_setting.DiscordGuildRule, matchAll bool) error {
	ctx := c.Request.Context()

	// 同一服务器只请求一次成员信息
	memberCache := make(map[string]*discordGuildMember)
	for _, rule := range rules {
		member, ok := memberCache[rule.GuildId]
		if !ok {
			var err error
			member, err = fetchGuildMember(ctx, token.AccessToken, rule.GuildId)
			if err != nil {
				return err
			}
			memberCache[rule.GuildId] = member
		}

		passed := member != nil && (rule.RoleId == "" || member.hasRole(rule.RoleId))
		if !passed && matchAll {
			if member == nil {
				return &AccessDeniedError{Message: i18n.T(c, i18n.MsgOAuthDiscordNotGuildMember)}
			}
			logger.LogDebug(ctx, "[OAuth-Discord] CheckGuildAccess: user lacks required role %s in guild %s", rule.RoleId, rule.GuildId)
			return &AccessDeniedError{Message: i18n.T(c, i18n.MsgOAuthDiscordMissingRole)}
		}
		if passed && !matchAll {
			return nil
		}
	}
	if matchAll {
		return nil
	}
	logger.LogDebug(ctx, "[OAuth-Discord] CheckGuildAccess: user satisfies none of the %d guild rules", len(rules))
	return &AccessDeniedError{Message: i18n.T(c, i18n.MsgOAuthDiscordGuildRulesNotSatisfied)}
}

func (p *DiscordProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.DiscordId = providerUserID
	return user.FillUserByDiscordId()
}

func (p *DiscordProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.DiscordId = providerUserID
}

func (p *DiscordProvider) GetProviderPrefix() string {
	return "discord_"
}
