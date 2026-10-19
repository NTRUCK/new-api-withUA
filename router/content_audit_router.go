package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// SetContentAuditRouter 内容审计查询接口（仅管理员）。
// 独立于 SetApiRouter 注册，避免污染主 API 路由文件。
func SetContentAuditRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.RouteTag("api"))
	apiRouter.Use(middleware.BodyStorageCleanup())
	{
		apiRouter.GET("/content_audit", middleware.AdminAuth(), controller.GetContentAuditLogs)
		apiRouter.GET("/content_audit/:id", middleware.AdminAuth(), controller.GetContentAuditLogDetail)
	}
}
