package system_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

func TestDiscordGuildRuleGroupsUnmarshalFlatCompat(t *testing.T) {
	// 历史平铺格式：每条规则视为一个只含单条规则的组
	var groups DiscordGuildRuleGroups
	raw := `[{"guild_id":"111","role_id":"222"},{"guild_id":"333"}]`
	if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
		t.Fatalf("解析平铺格式失败: %v", err)
	}
	if len(groups) != 2 {
		t.Fatalf("平铺格式应转换为 2 个单规则组，实际 %d 个: %+v", len(groups), groups)
	}
	if len(groups[0]) != 1 || groups[0][0].GuildId != "111" || groups[0][0].RoleId != "222" {
		t.Errorf("第 1 组内容错误: %+v", groups[0])
	}
	if len(groups[1]) != 1 || groups[1][0].GuildId != "333" || groups[1][0].RoleId != "" {
		t.Errorf("第 2 组内容错误: %+v", groups[1])
	}
}

func TestDiscordGuildRuleGroupsUnmarshalNested(t *testing.T) {
	var groups DiscordGuildRuleGroups
	raw := `[[{"guild_id":"111","role_id":""},{"guild_id":"333","role_id":""}],[{"guild_id":"444","role_id":"555"}]]`
	if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
		t.Fatalf("解析分组格式失败: %v", err)
	}
	if len(groups) != 2 || len(groups[0]) != 2 || len(groups[1]) != 1 {
		t.Fatalf("分组结构错误: %+v", groups)
	}
	if groups[0][1].GuildId != "333" || groups[1][0].RoleId != "555" {
		t.Errorf("分组内容错误: %+v", groups)
	}
}

func TestDiscordGuildRuleGroupsUnmarshalEmpty(t *testing.T) {
	for _, raw := range []string{`[]`, `null`} {
		var groups DiscordGuildRuleGroups
		if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
			t.Fatalf("解析 %s 失败: %v", raw, err)
		}
		if len(groups) != 0 {
			t.Errorf("%s 应解析为空，实际: %+v", raw, groups)
		}
	}
}

func TestFilterGuildRuleGroups(t *testing.T) {
	groups := DiscordGuildRuleGroups{
		{{GuildId: "111"}, {GuildId: ""}}, // 组内空服务器 ID 被剔除，该组仍保留
		{{GuildId: ""}},                   // 过滤后为空组，整组丢弃
	}
	valid := filterGuildRuleGroups(groups)
	if len(valid) != 1 || len(valid[0]) != 1 || valid[0][0].GuildId != "111" {
		t.Fatalf("过滤结果错误: %+v", valid)
	}
}

func TestDiscordRulesConfigRoundTrip(t *testing.T) {
	// 写入历史平铺格式后，结构体内部应为分组形式
	settings := DiscordSettings{}
	if err := config.UpdateConfigFromMap(&settings, map[string]string{
		"guild_rules": `[{"guild_id":"111","role_id":""}]`,
	}); err != nil {
		t.Fatalf("写入配置失败: %v", err)
	}
	if got := settings.GetGuildRules(); len(got) != 1 || len(got[0]) != 1 {
		t.Fatalf("配置写入后结构错误: %+v", got)
	}

	// 导出时应为分组 JSON
	exported, err := config.ConfigToMap(&DiscordSettings{
		GuildRules: DiscordGuildRuleGroups{
			{{GuildId: "111"}, {GuildId: "333"}},
			{{GuildId: "444"}},
		},
	})
	if err != nil {
		t.Fatalf("导出配置失败: %v", err)
	}
	want := `[[{"guild_id":"111","role_id":""},{"guild_id":"333","role_id":""}],[{"guild_id":"444","role_id":""}]]`
	if exported["guild_rules"] != want {
		t.Errorf("导出 JSON 错误:\n got %s\nwant %s", exported["guild_rules"], want)
	}
}

func TestDiscordRulesMatchAllDefaults(t *testing.T) {
	settings := DiscordSettings{}
	if settings.IsGuildRulesMatchAll() || settings.IsAffGuildRulesMatchAll() {
		t.Error("未配置时不应要求全部准入组均满足")
	}
	settings.GuildRulesMatch = "all"
	settings.AffGuildRulesMatch = "all"
	if !settings.IsGuildRulesMatchAll() || !settings.IsAffGuildRulesMatchAll() {
		t.Error("配置为 all 时应要求全部准入组均满足")
	}
}
