package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// SetContentAuditRouter 内容审计管理面板接口。
// 独立于 SetApiRouter 注册，避免污染主 API 路由文件。
//
// 鉴权：面板使用独立密码票据（X-Audit-Ticket），与登录 JWT 解耦；
// 仅 /audit_panel/login 与 /audit_panel/config 的读取允许无票据访问
// （前者用于登录，后者用于首屏判断是否需要引导设置密码）。
func SetContentAuditRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.RouteTag("api"))
	apiRouter.Use(middleware.BodyStorageCleanup())
	{
		panel := apiRouter.Group("/audit_panel")
		{
			panel.POST("/login", middleware.CriticalRateLimit(), controller.AuditPanelLogin)
			panel.GET("/config", controller.GetAuditPanelConfig)
			panel.PUT("/config", middleware.AuditPanelAuth(), controller.UpdateAuditPanelConfig)
			panel.GET("/users", middleware.AuditPanelAuth(), controller.GetAuditUsers)
			panel.GET("/sessions", middleware.AuditPanelAuth(), controller.GetAuditSessions)
			panel.GET("/session", middleware.AuditPanelAuth(), controller.GetAuditSessionDetail)
			panel.GET("/logs", middleware.AuditPanelAuth(), controller.GetContentAuditLogs)
			panel.GET("/logs/:id", middleware.AuditPanelAuth(), controller.GetContentAuditLogDetail)
		}
	}
}
