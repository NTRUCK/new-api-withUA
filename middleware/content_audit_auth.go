package middleware

import (
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// ===== 内容审计面板：额外密码票据 =====
// 面板不依赖登录 JWT，而使用独立密码换取短期票据（HMAC 签名，无状态），
// 避免管理员会话泄露即可读取全部用户对话内容。

const auditTicketTTL = 2 * time.Hour

// IssueAuditTicket 生成审计面板票据：<exp_unix>.<hmac>。
func IssueAuditTicket() (string, int64) {
	exp := time.Now().Add(auditTicketTTL).Unix()
	expStr := strconv.FormatInt(exp, 10)
	sig := common.GenerateHMAC("content_audit:" + expStr)
	return expStr + "." + sig, exp
}

// ValidateAuditTicket 校验票据签名与有效期。
func ValidateAuditTicket(ticket string) bool {
	parts := strings.SplitN(strings.TrimSpace(ticket), ".", 2)
	if len(parts) != 2 {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || exp < time.Now().Unix() {
		return false
	}
	expected := common.GenerateHMAC("content_audit:" + parts[0])
	return subtle.ConstantTimeCompare([]byte(expected), []byte(parts[1])) == 1
}

// AuditPanelAuth 校验审计面板票据（Header: X-Audit-Ticket）。
func AuditPanelAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !operation_setting.ContentAuditPasswordConfigured() {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"code":    "audit_password_not_set",
				"message": "审计面板尚未设置访问密码，请由站长在系统设置中配置",
			})
			c.Abort()
			return
		}
		if !ValidateAuditTicket(c.GetHeader("X-Audit-Ticket")) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"code":    "audit_ticket_invalid",
				"message": "审计面板凭证无效或已过期，请重新输入密码",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
