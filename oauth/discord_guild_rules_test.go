package oauth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// discordStubTransport 拦截对 Discord API 的请求，按服务器 ID 返回伪造的成员信息。
// members: guildId -> 该用户在此服务器持有的身份组；键不存在表示不是该服务器成员。
type discordStubTransport struct {
	members map[string][]string
}

func (s *discordStubTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	guildId := ""
	parts := strings.Split(req.URL.Path, "/")
	for i, p := range parts {
		if p == "guilds" && i+1 < len(parts) {
			guildId = parts[i+1]
			break
		}
	}

	res := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Request:    req,
	}
	roles, ok := s.members[guildId]
	if !ok {
		res.StatusCode = http.StatusNotFound
		res.Body = io.NopCloser(strings.NewReader(`{"code":10004,"message":"Unknown Member"}`))
		return res, nil
	}

	quoted := make([]string, 0, len(roles))
	for _, r := range roles {
		quoted = append(quoted, `"`+r+`"`)
	}
	res.Body = io.NopCloser(strings.NewReader(`{"roles":[` + strings.Join(quoted, ",") + `]}`))
	return res, nil
}

// runGuildRuleGroups 在伪造的 Discord 成员数据下执行准入组判定
func runGuildRuleGroups(t *testing.T, members map[string][]string, groups system_setting.DiscordGuildRuleGroups, matchAll bool) error {
	t.Helper()
	// 判定失败时会调用 i18n.T 取提示文案，需先加载语言资源
	if err := i18n.Init(); err != nil {
		t.Fatalf("i18n 初始化失败: %v", err)
	}

	oldTransport := http.DefaultTransport
	http.DefaultTransport = &discordStubTransport{members: members}
	t.Cleanup(func() { http.DefaultTransport = oldTransport })

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	return checkGuildRuleGroups(c, &OAuthToken{AccessToken: "test-token"}, groups, matchAll)
}

// 用户场景：组1要求 A+B，组2要求 A+C，组3要求 D+E
const (
	guildA = "100000000000000001"
	guildB = "100000000000000002"
	guildC = "100000000000000003"
	guildD = "100000000000000004"
	guildE = "100000000000000005"
	guildF = "100000000000000006"
)

func scenarioGroups() system_setting.DiscordGuildRuleGroups {
	return system_setting.DiscordGuildRuleGroups{
		{{GuildId: guildA}, {GuildId: guildB}},
		{{GuildId: guildA}, {GuildId: guildC}},
		{{GuildId: guildD}, {GuildId: guildE}},
	}
}

func memberOf(ids ...string) map[string][]string {
	members := make(map[string][]string, len(ids))
	for _, id := range ids {
		members[id] = nil
	}
	return members
}

func TestCheckGuildRuleGroupsAnyMode(t *testing.T) {
	cases := []struct {
		name    string
		members map[string][]string
		allowed bool
	}{
		{"只有 A：三组均不满足", memberOf(guildA), false},
		{"A+B：满足组1", memberOf(guildA, guildB), true},
		{"A+C：满足组2", memberOf(guildA, guildC), true},
		{"D+E：满足组3", memberOf(guildD, guildE), true},
		{"只有 F：均不满足", memberOf(guildF), false},
		{"A+B+C：满足组1与组2", memberOf(guildA, guildB, guildC), true},
		{"B+C：缺 A，均不满足", memberOf(guildB, guildC), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := runGuildRuleGroups(t, tc.members, scenarioGroups(), false)
			if tc.allowed && err != nil {
				t.Fatalf("应放行但被拒绝: %v", err)
			}
			if !tc.allowed && err == nil {
				t.Fatal("应拒绝但被放行")
			}
		})
	}
}

func TestCheckGuildRuleGroupsAllMode(t *testing.T) {
	cases := []struct {
		name    string
		members map[string][]string
		allowed bool
	}{
		{"A+B+C：组3未满足", memberOf(guildA, guildB, guildC), false},
		{"A+B+C+D+E：三组均满足", memberOf(guildA, guildB, guildC, guildD, guildE), true},
		{"只有 A：三组均不满足", memberOf(guildA), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := runGuildRuleGroups(t, tc.members, scenarioGroups(), true)
			if tc.allowed && err != nil {
				t.Fatalf("应放行但被拒绝: %v", err)
			}
			if !tc.allowed && err == nil {
				t.Fatal("应拒绝但被放行")
			}
		})
	}
}

func TestCheckGuildRuleGroupsRoleRequirement(t *testing.T) {
	const roleId = "200000000000000001"
	groups := system_setting.DiscordGuildRuleGroups{
		{{GuildId: guildA, RoleId: roleId}},
	}

	// 是成员但未持有身份组
	if err := runGuildRuleGroups(t, map[string][]string{guildA: {"999999999999999999"}}, groups, false); err == nil {
		t.Fatal("缺少身份组时应拒绝")
	}
	// 持有身份组
	if err := runGuildRuleGroups(t, map[string][]string{guildA: {roleId}}, groups, false); err != nil {
		t.Fatalf("持有身份组时应放行，实际: %v", err)
	}
}

// runResolveRegisterGroup 在伪造的 Discord 成员数据与临时映射规则下解析注册分组
func runResolveRegisterGroup(t *testing.T, members map[string][]string, rules []system_setting.DiscordRoleGroupRule) string {
	t.Helper()

	settings := system_setting.GetDiscordSettings()
	oldEnabled, oldRules := settings.RoleGroupEnabled, settings.RoleGroupRules
	settings.RoleGroupEnabled = true
	settings.RoleGroupRules = rules
	t.Cleanup(func() {
		settings.RoleGroupEnabled = oldEnabled
		settings.RoleGroupRules = oldRules
	})

	oldTransport := http.DefaultTransport
	http.DefaultTransport = &discordStubTransport{members: members}
	t.Cleanup(func() { http.DefaultTransport = oldTransport })

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	group, err := ResolveRegisterGroup(c, &OAuthToken{AccessToken: "test-token"})
	if err != nil {
		t.Fatalf("解析注册分组失败: %v", err)
	}
	return group
}

func TestResolveRegisterGroupPriority(t *testing.T) {
	const (
		roleVip    = "200000000000000011"
		roleSvip   = "200000000000000012"
		roleOther  = "200000000000000013"
		guildOther = "100000000000000009"
	)
	rules := []system_setting.DiscordRoleGroupRule{
		{GuildId: guildA, RoleId: roleVip, Group: "vip", Priority: 10},
		{GuildId: guildA, RoleId: roleSvip, Group: "svip", Priority: 20},
		{GuildId: guildA, RoleId: roleOther, Group: "tavern", Priority: 5},
		{GuildId: guildA, Group: "default", Priority: 0}, // 身份组留空：该服务器任意成员
		{GuildId: guildOther, RoleId: roleOther, Group: "other", Priority: 30},
	}

	cases := []struct {
		name    string
		members map[string][]string
		want    string
	}{
		{"多身份组取优先级最高", map[string][]string{guildA: {roleVip, roleSvip, roleOther}}, "svip"},
		{"仅持有低优先级身份组", map[string][]string{guildA: {roleVip}}, "vip"},
		{"仅命中任意成员规则", map[string][]string{guildA: nil}, "default"},
		{"跨服务器取最高优先级", map[string][]string{guildA: {roleVip}, guildOther: {roleOther}}, "other"},
		{"未命中任何规则", map[string][]string{guildF: nil}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := runResolveRegisterGroup(t, tc.members, rules); got != tc.want {
				t.Fatalf("期望分组 %q，实际 %q", tc.want, got)
			}
		})
	}
}
