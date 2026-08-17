package operation_setting

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

var DemoSiteEnabled = false
var SelfUseModeEnabled = false

var AutomaticDisableKeywords = []string{
	"Your credit balance is too low",
	"This organization has been disabled.",
	"You exceeded your current quota",
	"Permission denied",
	"The security token included in the request is invalid",
	"Operation not allowed",
	"Your account is not authorized",
}

func AutomaticDisableKeywordsToString() string {
	return strings.Join(AutomaticDisableKeywords, "\n")
}

func AutomaticDisableKeywordsFromString(s string) {
	AutomaticDisableKeywords = []string{}
	ak := strings.Split(s, "\n")
	for _, k := range ak {
		k = strings.TrimSpace(k)
		k = strings.ToLower(k)
		if k != "" {
			AutomaticDisableKeywords = append(AutomaticDisableKeywords, k)
		}
	}
}

// UserAgentBanEnabled 开启后，命中关键词的客户端 User-Agent 将被自动封禁并公开上榜
var UserAgentBanEnabled = false

// UserAgentBanKeywords 触发自动封禁的 User-Agent 关键词（小写、子串包含匹配）
var UserAgentBanKeywords = []string{
	"tavo",
}

func UserAgentBanKeywordsToString() string {
	return strings.Join(UserAgentBanKeywords, "\n")
}

func UserAgentBanKeywordsFromString(s string) {
	UserAgentBanKeywords = []string{}
	for _, k := range strings.Split(s, "\n") {
		k = strings.TrimSpace(strings.ToLower(k))
		if k != "" {
			UserAgentBanKeywords = append(UserAgentBanKeywords, k)
		}
	}
}

// MatchUserAgentBan 返回命中的封禁关键词；未开启、UA 为空或无命中时返回空字符串。
// 采用大小写不敏感的子串包含匹配。
func MatchUserAgentBan(userAgent string) string {
	if !UserAgentBanEnabled {
		return ""
	}
	ua := strings.ToLower(strings.TrimSpace(userAgent))
	if ua == "" {
		return ""
	}
	for _, k := range UserAgentBanKeywords {
		if k != "" && strings.Contains(ua, k) {
			return k
		}
	}
	return ""
}

// ===== 分组级 User-Agent 黑/白名单 =====

// UserAgentGroupWhitelist 分组白名单：group -> 允许的 UA 关键词（小写）。
// 某分组配置了白名单后，该分组请求的 UA 必须命中其中之一，否则视为违规。
var UserAgentGroupWhitelist = map[string][]string{}

// UserAgentGroupBlacklist 分组黑名单：group -> 禁止的 UA 关键词（小写）。
// 命中即视为违规。
var UserAgentGroupBlacklist = map[string][]string{}

// UserAgentGroupBanThreshold 分组黑/白名单累计违规多少次后封禁用户（默认 5）。
var UserAgentGroupBanThreshold = 5

// UserAgentGroupExemptUserIds 仅豁免分组级 UA 黑/白名单，仍受全局违规 UA 关键词限制。
var UserAgentGroupExemptUserIds = map[int]struct{}{}

func UserAgentGroupExemptUserIdsToString() string {
	ids := make([]int, 0, len(UserAgentGroupExemptUserIds))
	for id := range UserAgentGroupExemptUserIds {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.Itoa(id))
	}
	return strings.Join(parts, ",")
}

func UserAgentGroupExemptUserIdsFromString(s string) {
	UserAgentGroupExemptUserIds = map[int]struct{}{}
	for _, part := range strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == ' ' || r == '\t'
	}) {
		if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && id > 0 {
			UserAgentGroupExemptUserIds[id] = struct{}{}
		}
	}
}

func IsUserAgentGroupExemptUser(userId int) bool {
	_, ok := UserAgentGroupExemptUserIds[userId]
	return ok
}

// parseGroupUAConfig 解析「每行 group:ua1,ua2」格式，返回 group -> 小写关键词列表。
func parseGroupUAConfig(s string) map[string][]string {
	result := map[string][]string{}
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		idx := strings.Index(line, ":")
		if idx <= 0 {
			continue
		}
		group := strings.TrimSpace(line[:idx])
		if group == "" {
			continue
		}
		var uas []string
		for _, ua := range strings.Split(line[idx+1:], ",") {
			ua = strings.TrimSpace(strings.ToLower(ua))
			if ua != "" {
				uas = append(uas, ua)
			}
		}
		if len(uas) > 0 {
			result[group] = uas
		}
	}
	return result
}

func serializeGroupUAConfig(m map[string][]string) string {
	var lines []string
	for group, uas := range m {
		lines = append(lines, group+":"+strings.Join(uas, ","))
	}
	return strings.Join(lines, "\n")
}

func UserAgentGroupWhitelistToString() string {
	return serializeGroupUAConfig(UserAgentGroupWhitelist)
}

func UserAgentGroupWhitelistFromString(s string) {
	UserAgentGroupWhitelist = parseGroupUAConfig(s)
}

func UserAgentGroupBlacklistToString() string {
	return serializeGroupUAConfig(UserAgentGroupBlacklist)
}

func UserAgentGroupBlacklistFromString(s string) {
	UserAgentGroupBlacklist = parseGroupUAConfig(s)
}

// MatchUserAgentGroupPolicy 校验某分组下的 UA 是否违反黑/白名单。
// 黑名单优先，再白名单。返回违规原因（为空表示放行）。
// 仅当该分组配置了对应名单时才生效；未开启总开关时始终放行。
func MatchUserAgentGroupPolicy(group, userAgent string) string {
	if !UserAgentBanEnabled || group == "" {
		return ""
	}
	ua := strings.ToLower(strings.TrimSpace(userAgent))
	// 分组黑名单：命中即违规
	if blacklist, ok := UserAgentGroupBlacklist[group]; ok && len(blacklist) > 0 {
		for _, k := range blacklist {
			if k != "" && ua != "" && strings.Contains(ua, k) {
				return fmt.Sprintf("分组 %s 命中禁用客户端关键词：%s", group, k)
			}
		}
	}
	// 分组白名单：必须命中其一，否则违规
	if whitelist, ok := UserAgentGroupWhitelist[group]; ok && len(whitelist) > 0 {
		for _, k := range whitelist {
			if k != "" && ua != "" && strings.Contains(ua, k) {
				return ""
			}
		}
		return fmt.Sprintf("分组 %s 的客户端 User-Agent 不在允许列表内", group)
	}
	return ""
}
