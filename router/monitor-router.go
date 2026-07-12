package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func SetMonitorRouter(router *gin.Engine) {
	watchingRoute := router.Group("/watching")
	watchingRoute.Use(middleware.GlobalWebRateLimit())
	{
		watchingRoute.GET("", controller.MonitorPage)
		watchingRoute.POST("/login", controller.MonitorLogin)
		watchingRoute.GET("/logout", controller.MonitorLogout)
		watchingRoute.GET("/api/users", controller.MonitorUsers)
		watchingRoute.GET("/api/contents", controller.MonitorContents)
	}
}
