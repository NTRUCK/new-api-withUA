package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// providerParams returns map with Provider key for i18n templates
func providerParams(name string) map[string]any {
	return map[string]any{"Provider": name}
}

// GenerateOAuthCode generates a state code for OAuth CSRF protection
func GenerateOAuthCode(c *gin.Context) {
	session := sessions.Default(c)
	state := common.GetRandomString(12)
	affCode := c.Query("aff")
	if affCode != "" {
		session.Set("aff", affCode)
	}
	session.Set("oauth_state", state)
	err := session.Save()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    state,
	})
}

// HandleOAuth handles OAuth callback for all standard OAuth providers
func HandleOAuth(c *gin.Context) {
	providerName := c.Param("provider")
	provider := oauth.GetProvider(providerName)
	if provider == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgOAuthUnknownProvider),
		})
		return
	}

	session := sessions.Default(c)

	// 1. Validate state (CSRF protection)
	state := c.Query("state")
	if state == "" || session.Get("oauth_state") == nil || state != session.Get("oauth_state").(string) {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgOAuthStateInvalid),
		})
		return
	}

	// 2. Check if user is already logged in (bind flow)
	username := session.Get("username")
	if username != nil {
		handleOAuthBind(c, provider)
		return
	}

	// 3. Check if provider is enabled
	if !provider.IsEnabled() {
		common.ApiErrorI18n(c, i18n.MsgOAuthNotEnabled, providerParams(provider.GetName()))
		return
	}

	// 4. Handle error from provider
	errorCode := c.Query("error")
	if errorCode != "" {
		errorDescription := c.Query("error_description")
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": errorDescription,
		})
		return
	}

	// 5. Exchange code for token
	code := c.Query("code")
	token, err := provider.ExchangeToken(c.Request.Context(), code, c)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// 6. Get user info
	oauthUser, err := provider.GetUserInfo(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// 6.5 Discord 服务器准入校验（每次登录/注册都执行）
	if provider.GetName() == "Discord" {
		if err := oauth.CheckGuildAccess(c, token); err != nil {
			handleOAuthError(c, err)
			return
		}
	}

	// 6.6 邀请码专属准入：开启后新用户注册只能通过 Discord 完成，
	// 且需满足邀请专属的服务器/身份组规则（已有用户登录不受影响）
	if !provider.IsUserIDTaken(oauthUser.ProviderUserID) &&
		len(system_setting.GetDiscordSettings().GetAffGuildRules()) > 0 {
		if provider.GetName() != "Discord" {
			common.ApiErrorI18n(c, i18n.MsgUserAffDiscordOnly)
			return
		}
		if err := oauth.CheckAffGuildAccess(c, token); err != nil {
			handleOAuthError(c, err)
			return
		}
	}

	// 6.7 注册分组：仅普通注册（不带邀请码）生效，带邀请码的注册仍分配默认用户组。
	// 命中多条取优先级最高者；启用后未命中任何规则则拒绝注册。
	registerGroup := ""
	isInviteRegister := false
	if aff := session.Get("aff"); aff != nil {
		if affCode, ok := aff.(string); ok && strings.TrimSpace(affCode) != "" {
			isInviteRegister = true
		}
	}
	if provider.GetName() == "Discord" &&
		system_setting.GetDiscordSettings().RoleGroupEnabled &&
		!isInviteRegister &&
		!provider.IsUserIDTaken(oauthUser.ProviderUserID) {
		group, err := oauth.ResolveRegisterGroup(c, token)
		if err != nil {
			handleOAuthError(c, err)
			return
		}
		if group == "" || !ratio_setting.ContainsGroupRatio(group) {
			common.ApiErrorI18n(c, i18n.MsgOAuthDiscordRoleGroupNotMatched)
			return
		}
		registerGroup = group
	}

	// 7. Find or create user
	user, err := findOrCreateOAuthUser(c, provider, oauthUser, session, registerGroup)
	if err != nil {
		switch e := err.(type) {
		case *OAuthUserDeletedError:
			common.ApiErrorI18n(c, i18n.MsgOAuthUserDeleted)
		case *OAuthRegistrationDisabledError:
			common.ApiErrorI18n(c, i18n.MsgUserRegisterDisabled)
		case *OAuthAffCodeError:
			common.ApiErrorI18n(c, e.MsgKey)
		default:
			common.ApiError(c, err)
		}
		return
	}

	// 8. Check user status
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorI18n(c, i18n.MsgOAuthUserBanned)
		return
	}

	// 9. Setup login
	setupLogin(user, c)
}

// handleOAuthBind handles binding OAuth account to existing user
func handleOAuthBind(c *gin.Context, provider oauth.Provider) {
	if !provider.IsEnabled() {
		common.ApiErrorI18n(c, i18n.MsgOAuthNotEnabled, providerParams(provider.GetName()))
		return
	}

	// Exchange code for token
	code := c.Query("code")
	token, err := provider.ExchangeToken(c.Request.Context(), code, c)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// Get user info
	oauthUser, err := provider.GetUserInfo(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// Discord 服务器准入校验（绑定时同样要求满足服务器/身份组条件）
	if provider.GetName() == "Discord" {
		if err := oauth.CheckGuildAccess(c, token); err != nil {
			handleOAuthError(c, err)
			return
		}
	}

	// Check if this OAuth account is already bound (check both new ID and legacy ID)
	if provider.IsUserIDTaken(oauthUser.ProviderUserID) {
		common.ApiErrorI18n(c, i18n.MsgOAuthAlreadyBound, providerParams(provider.GetName()))
		return
	}
	// Also check legacy ID to prevent duplicate bindings during migration period
	if legacyID, ok := oauthUser.Extra["legacy_id"].(string); ok && legacyID != "" {
		if provider.IsUserIDTaken(legacyID) {
			common.ApiErrorI18n(c, i18n.MsgOAuthAlreadyBound, providerParams(provider.GetName()))
			return
		}
	}

	// Get current user from session
	session := sessions.Default(c)
	id := session.Get("id")
	user := model.User{Id: id.(int)}
	err = user.FillUserById()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Handle binding based on provider type
	if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
		// Custom provider: use user_oauth_bindings table
		err = model.UpdateUserOAuthBinding(user.Id, genericProvider.GetProviderId(), oauthUser.ProviderUserID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	} else {
		// Built-in provider: update user record directly
		provider.SetProviderUserID(&user, oauthUser.ProviderUserID)
		if provider.GetName() == "Discord" {
			applyDiscordOAuthProfile(&user, oauthUser)
		}
		err = user.Update(false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}

	common.ApiSuccessI18n(c, i18n.MsgOAuthBindSuccess, gin.H{
		"action": "bind",
	})
}

// findOrCreateOAuthUser finds existing user or creates new user
func findOrCreateOAuthUser(c *gin.Context, provider oauth.Provider, oauthUser *oauth.OAuthUser, session sessions.Session, registerGroup string) (*model.User, error) {
	user := &model.User{}

	// Check if user already exists with new ID
	if provider.IsUserIDTaken(oauthUser.ProviderUserID) {
		err := provider.FillUserByProviderID(user, oauthUser.ProviderUserID)
		if err != nil {
			return nil, err
		}
		// Check if user has been deleted
		if user.Id == 0 {
			return nil, &OAuthUserDeletedError{}
		}
		if provider.GetName() == "Discord" {
			applyDiscordOAuthProfile(user, oauthUser)
			if err := model.DB.Model(user).Updates(map[string]interface{}{
				"discord_username":    user.DiscordUsername,
				"discord_global_name": user.DiscordGlobalName,
				"discord_avatar":      user.DiscordAvatar,
			}).Error; err != nil {
				return nil, err
			}
		}
		return user, nil
	}

	// Try to find user with legacy ID (for GitHub migration from login to numeric ID)
	if legacyID, ok := oauthUser.Extra["legacy_id"].(string); ok && legacyID != "" {
		if provider.IsUserIDTaken(legacyID) {
			err := provider.FillUserByProviderID(user, legacyID)
			if err != nil {
				return nil, err
			}
			if user.Id != 0 {
				// Found user with legacy ID, migrate to new ID
				common.SysLog(fmt.Sprintf("[OAuth] Migrating user %d from legacy_id=%s to new_id=%s",
					user.Id, legacyID, oauthUser.ProviderUserID))
				if err := user.UpdateGitHubId(oauthUser.ProviderUserID); err != nil {
					common.SysError(fmt.Sprintf("[OAuth] Failed to migrate user %d: %s", user.Id, err.Error()))
					// Continue with login even if migration fails
				}
				return user, nil
			}
		}
	}

	// User doesn't exist, create new user if registration is enabled
	if !common.RegisterEnabled {
		return nil, &OAuthRegistrationDisabledError{}
	}
	// 开启注册审核时，OAuth 注册无法填写申请理由与联系方式，须改用密码注册提交申请
	if common.RegisterReviewEnabled {
		return nil, &OAuthRegistrationDisabledError{}
	}
	limitWhitelisted := provider.GetName() == "Discord" && system_setting.IsDiscordRegisterLimitWhitelisted(oauthUser.ProviderUserID)
	if isRegisterUserCountReached() && !limitWhitelisted {
		return nil, &OAuthRegistrationDisabledError{}
	}

	// Set up new user
	user.Username = provider.GetProviderPrefix() + strconv.Itoa(model.GetMaxUserId()+1)

	if oauthUser.Username != "" {
		if exists, err := model.CheckUserExistOrDeleted(oauthUser.Username, ""); err == nil && !exists {
			// 防止索引退化
			if len(oauthUser.Username) <= model.UserNameMaxLength {
				user.Username = oauthUser.Username
			}
		}
	}

	if oauthUser.DisplayName != "" {
		user.DisplayName = oauthUser.DisplayName
	} else if oauthUser.Username != "" {
		user.DisplayName = oauthUser.Username
	} else {
		user.DisplayName = provider.GetName() + " User"
	}
	if oauthUser.Email != "" {
		user.Email = oauthUser.Email
	}
	user.Role = common.RoleCommonUser
	user.Status = common.UserStatusEnabled
	if registerGroup != "" {
		user.Group = registerGroup
	}
	if provider.GetName() == "Discord" {
		applyDiscordOAuthProfile(user, oauthUser)
	}

	// Handle affiliate code
	affCode := session.Get("aff")
	affCodeStr := ""
	if affCode != nil {
		affCodeStr, _ = affCode.(string)
	}
	inviterId, affErr := service.ResolveInviterByAffCode(affCodeStr)
	if affErr != nil {
		return nil, &OAuthAffCodeError{MsgKey: service.AffCodeErrorI18nKey(affErr)}
	}

	// Use transaction to ensure user creation and OAuth binding are atomic
	if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
		// Custom provider: create user and binding in a transaction
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			// Create user
			if err := user.InsertWithTx(tx, inviterId); err != nil {
				return err
			}

			// Create OAuth binding
			binding := &model.UserOAuthBinding{
				UserId:         user.Id,
				ProviderId:     genericProvider.GetProviderId(),
				ProviderUserId: oauthUser.ProviderUserID,
			}
			if err := model.CreateUserOAuthBindingWithTx(tx, binding); err != nil {
				return err
			}

			return nil
		})
		if err != nil {
			return nil, err
		}

		// Perform post-transaction tasks (logs, sidebar config, inviter rewards)
		user.FinalizeOAuthUserCreation(inviterId)
	} else {
		// Built-in provider: create user and update provider ID in a transaction
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			// Create user
			if err := user.InsertWithTx(tx, inviterId); err != nil {
				return err
			}

			// Set the provider user ID on the user model and update
			provider.SetProviderUserID(user, oauthUser.ProviderUserID)
			if provider.GetName() == "Discord" {
				applyDiscordOAuthProfile(user, oauthUser)
			}
			if err := tx.Model(user).Updates(map[string]interface{}{
				"github_id":           user.GitHubId,
				"discord_id":          user.DiscordId,
				"discord_username":    user.DiscordUsername,
				"discord_global_name": user.DiscordGlobalName,
				"discord_avatar":      user.DiscordAvatar,
				"oidc_id":             user.OidcId,
				"linux_do_id":         user.LinuxDOId,
				"wechat_id":           user.WeChatId,
				"telegram_id":         user.TelegramId,
			}).Error; err != nil {
				return err
			}

			return nil
		})
		if err != nil {
			return nil, err
		}

		// Perform post-transaction tasks
		user.FinalizeOAuthUserCreation(inviterId)
	}

	return user, nil
}

func applyDiscordOAuthProfile(user *model.User, oauthUser *oauth.OAuthUser) {
	user.DiscordUsername, _ = oauthUser.Extra["discord_username"].(string)
	user.DiscordGlobalName, _ = oauthUser.Extra["discord_global_name"].(string)
	user.DiscordAvatar, _ = oauthUser.Extra["discord_avatar"].(string)
}

type discordRoleGroupPreviewRequest struct {
	Query string                                `json:"query"`
	Rules []system_setting.DiscordRoleGroupRule `json:"rules"`
}

// PreviewDiscordRoleGroup 用 Bot Token 查询指定 Discord 用户的服务器成员与身份组，
// 并按当前编辑中的规则计算其注册时将被分配的用户组，供管理端保存前验证配置。
func PreviewDiscordRoleGroup(c *gin.Context) {
	var req discordRoleGroupPreviewRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		common.ApiErrorMsg(c, "请输入 Discord 用户 ID 或用户名")
		return
	}

	rules := make([]system_setting.DiscordRoleGroupRule, 0, len(req.Rules))
	guildIds := make([]string, 0, len(req.Rules))
	seen := make(map[string]struct{})
	for _, rule := range req.Rules {
		guildId := strings.TrimSpace(rule.GuildId)
		group := strings.TrimSpace(rule.Group)
		if guildId == "" || group == "" {
			continue
		}
		rule.GuildId = guildId
		rule.RoleId = strings.TrimSpace(rule.RoleId)
		rule.Group = group
		rules = append(rules, rule)
		if _, ok := seen[guildId]; !ok {
			seen[guildId] = struct{}{}
			guildIds = append(guildIds, guildId)
		}
	}
	if len(rules) == 0 {
		common.ApiErrorMsg(c, "请先添加至少一条有效的注册分组规则")
		return
	}

	result, err := service.LookupDiscordUserInGuilds(query, guildIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	matchedGroup := ""
	matchedIndex := -1
	matchedPriority := 0
	for i, rule := range rules {
		var membership *service.DiscordGuildMembership
		for j := range result.Memberships {
			if result.Memberships[j].GuildId == rule.GuildId {
				membership = &result.Memberships[j]
				break
			}
		}
		if membership == nil || !membership.InGuild {
			continue
		}
		if rule.RoleId != "" && !hasDiscordRole(membership.Roles, rule.RoleId) {
			continue
		}
		if matchedIndex == -1 || rule.Priority > matchedPriority {
			matchedGroup = rule.Group
			matchedIndex = i
			matchedPriority = rule.Priority
		}
	}

	common.ApiSuccess(c, gin.H{
		"user":               result,
		"matched_group":      matchedGroup,
		"matched_rule_index": matchedIndex,
	})
}

func hasDiscordRole(roles []service.DiscordRoleInfo, roleId string) bool {
	for _, role := range roles {
		if role.Id == roleId {
			return true
		}
	}
	return false
}

// Error types for OAuth
type OAuthUserDeletedError struct{}

func (e *OAuthUserDeletedError) Error() string {
	return "user has been deleted"
}

type OAuthRegistrationDisabledError struct{}

func (e *OAuthRegistrationDisabledError) Error() string {
	return "registration is disabled"
}

// OAuthAffCodeError 表示 OAuth 注册阶段邀请码校验失败，MsgKey 为对应的 i18n 消息 key
type OAuthAffCodeError struct {
	MsgKey string
}

func (e *OAuthAffCodeError) Error() string {
	return "invitation code check failed"
}

// handleOAuthError handles OAuth errors and returns translated message
func handleOAuthError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *oauth.OAuthError:
		if e.Params != nil {
			common.ApiErrorI18n(c, e.MsgKey, e.Params)
		} else {
			common.ApiErrorI18n(c, e.MsgKey)
		}
	case *oauth.AccessDeniedError:
		common.ApiErrorMsg(c, e.Message)
	case *oauth.TrustLevelError:
		common.ApiErrorI18n(c, i18n.MsgOAuthTrustLevelLow)
	default:
		common.ApiError(c, err)
	}
}
