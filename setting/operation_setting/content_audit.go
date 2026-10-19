package operation_setting

import (
	"strconv"
	"strings"
	"sync/atomic"
)

// ===== 内容审计 =====
// 记录用户请求与 AI 回复的完整内容，供管理员取证（例如核实某用户是否伪造客户端
// UA、表面用酒馆实际跑脚本）。支持两种记录范围：
//   - whitelist（默认）：仅记录命中用户/分组白名单的请求
//   - all：记录全部用户的请求
// 全量模式必须依赖 gzip 压缩与容量上限保护，避免撑爆磁盘。

var (
	ContentAuditEnabled           bool
	ContentAuditMode              string // whitelist / all
	ContentAuditUserIdsCsv        string // 逗号分隔的用户 ID 白名单
	ContentAuditGroupsCsv         string // 逗号分隔的分组白名单
	ContentAuditMaxBodyBytes      int    // 请求/响应单边捕获上限（字节），超出截断
	ContentAuditKeepDays          int    // 记录保留天数
	ContentAuditSessionGapMinutes int    // 同一会话的最大请求间隔（分钟）
	ContentAuditMaxTableMB        int    // 审计表容量上限（MB），超过后停止记录并告警
	ContentAuditPanelPasswordHash string // 面板访问密码（bcrypt）
	ContentAuditPanelSecret       string // 面板登录票据 HMAC 密钥
)

const (
	// 单边 64KB：请求体按「头部+尾部」保留，兼顾 system prompt 与最新用户消息
	defaultContentAuditMaxBodyBytes      = 65536
	maxContentAuditMaxBodyBytes          = 4 * 1024 * 1024
	defaultContentAuditKeepDays          = 30
	defaultContentAuditSessionGapMinutes = 30
	defaultContentAuditMaxTableMB        = 4096 // 4GB，留足磁盘余量
	ContentAuditModeWhitelist            = "whitelist"
	ContentAuditModeAll                  = "all"
)

type contentAuditMatcher struct {
	ids    map[int]struct{}
	groups map[string]struct{}
}

var contentAuditMatcherPtr atomic.Pointer[contentAuditMatcher]

// overCapacity 审计表超过容量上限后置位，停止写入并告警。
var contentAuditOverCapacity atomic.Bool

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
	// 默认全量记录：用户诉求是排查「不止一个人」的异常客户端；
	// 存储压力由单条截断、gzip 压缩与容量上限共同兜底。
	ContentAuditMode = ContentAuditModeAll
	ContentAuditMaxBodyBytes = defaultContentAuditMaxBodyBytes
	ContentAuditKeepDays = defaultContentAuditKeepDays
	ContentAuditSessionGapMinutes = defaultContentAuditSessionGapMinutes
	ContentAuditMaxTableMB = defaultContentAuditMaxTableMB
	RefreshContentAuditMatcher()
}

// ContentAuditMatches 判断该用户/分组是否命中审计目标。
func ContentAuditMatches(userId int, group string) bool {
	if !ContentAuditEnabled || contentAuditOverCapacity.Load() {
		return false
	}
	if ContentAuditMode == ContentAuditModeAll {
		return userId > 0
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

// GetContentAuditSessionGap 返回会话切分间隔秒数。
func GetContentAuditSessionGap() int64 {
	if ContentAuditSessionGapMinutes <= 0 {
		return int64(defaultContentAuditSessionGapMinutes) * 60
	}
	return int64(ContentAuditSessionGapMinutes) * 60
}

// IsContentAuditOverCapacity 供面板展示容量熔断状态。
func IsContentAuditOverCapacity() bool {
	return contentAuditOverCapacity.Load()
}

// SetContentAuditOverCapacity 由容量检查逻辑置位/复位。
func SetContentAuditOverCapacity(v bool) {
	contentAuditOverCapacity.Store(v)
}

// ContentAuditPasswordConfigured 面板是否已设置密码。
func ContentAuditPasswordConfigured() bool {
	return strings.TrimSpace(ContentAuditPanelPasswordHash) != ""
}
