package operation_setting

import "strings"

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
