package operation_setting

import (
	"strconv"
	"strings"
	"sync/atomic"
)

// ===== 内容审计 =====
// 按用户/分组白名单记录完整请求体与响应体，供管理员取证（例如核实某用户是否
// 伪造客户端 UA、表面用酒馆实际跑脚本）。白名单为空时即使总开关打开也不记录，
// 避免误开造成磁盘与数据库压力。

var (
	ContentAuditEnabled      bool
	ContentAuditUserIdsCsv   string // 逗号分隔的用户 ID 白名单
	ContentAuditGroupsCsv    string // 逗号分隔的分组白名单
	ContentAuditMaxBodyBytes int    // 请求/响应单边捕获上限（字节），超出截断
	ContentAuditKeepDays     int    // 记录保留天数，0 表示不自动清理
)

const defaultContentAuditMaxBodyBytes = 131072 // 128KB

const maxContentAuditMaxBodyBytes = 4 * 1024 * 1024 // 4MB 硬上限

type contentAuditMatcher struct {
	ids    map[int]struct{}
	groups map[string]struct{}
}

var contentAuditMatcherPtr atomic.Pointer[contentAuditMatcher]

func parseContentAuditIds(csv string) map[int]struct{} {
	out := make(map[int]struct{})
	for _, p := range strings.Split(csv, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			out[v] = struct{}{}
		}
	}
	return out
}

func parseContentAuditGroups(csv string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, p := range strings.Split(csv, ",") {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			out[p] = struct{}{}
		}
	}
	return out
}

// RefreshContentAuditMatcher 名单 CSV 变更后重建内存匹配器（options 更新时调用）。
func RefreshContentAuditMatcher() {
	contentAuditMatcherPtr.Store(&contentAuditMatcher{
		ids:    parseContentAuditIds(ContentAuditUserIdsCsv),
		groups: parseContentAuditGroups(ContentAuditGroupsCsv),
	})
}

func init() {
	ContentAuditMaxBodyBytes = defaultContentAuditMaxBodyBytes
	RefreshContentAuditMatcher()
}

// ContentAuditMatches 判断该用户/分组是否命中审计目标。
func ContentAuditMatches(userId int, group string) bool {
	if !ContentAuditEnabled {
		return false
	}
	m := contentAuditMatcherPtr.Load()
	if m == nil || (len(m.ids) == 0 && len(m.groups) == 0) {
		return false
	}
	if userId > 0 {
		if _, ok := m.ids[userId]; ok {
			return true
		}
	}
	if group != "" {
		if _, ok := m.groups[strings.ToLower(group)]; ok {
			return true
		}
	}
	return false
}

// GetContentAuditMaxBodyBytes 返回钳制后的单边捕获上限。
func GetContentAuditMaxBodyBytes() int {
	if ContentAuditMaxBodyBytes <= 0 {
		return defaultContentAuditMaxBodyBytes
	}
	if ContentAuditMaxBodyBytes > maxContentAuditMaxBodyBytes {
		return maxContentAuditMaxBodyBytes
	}
	return ContentAuditMaxBodyBytes
}
