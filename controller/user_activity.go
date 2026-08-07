package controller

import (
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 活跃度统计缓存：避免频繁扫描日志库，60 秒内复用结果
var (
	activeStatsCache     model.ActiveUserStats
	activeStatsCacheTime time.Time
	activeStatsCacheMu   sync.Mutex
)

const activeStatsCacheTTL = 60 * time.Second

func getActiveUserStatsCached() (model.ActiveUserStats, error) {
	activeStatsCacheMu.Lock()
	defer activeStatsCacheMu.Unlock()
	if time.Since(activeStatsCacheTime) < activeStatsCacheTTL {
		return activeStatsCache, nil
	}
	stats, err := model.GetActiveUserStats()
	if err != nil {
		return stats, err
	}
	activeStatsCache = stats
	activeStatsCacheTime = time.Now()
	return stats, nil
}

// GetActiveUsers 全站活跃人数（近 1 小时调用 >=10 次），所有登录用户可见
func GetActiveUsers(c *gin.Context) {
	stats, err := getActiveUserStatsCached()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	welfarePool, err := model.GetDiceWelfarePoolQuota()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"active_users_1h":     stats.ActiveUsers1h,
			"yesterday_top_user":  stats.YesterdayTopUser,
			"yesterday_top_calls": stats.YesterdayTopCalls,
			"welfare_pool":        welfarePool,
			"richest_user":        stats.RichestUser,
			"richest_user_quota":  stats.RichestUserQuota,
		},
	})
}

// GetUserActivityStats 管理员内部参考：1h 调用人数 / 24h 调用人数 / 24h 高频人数
func GetUserActivityStats(c *gin.Context) {
	stats, err := getActiveUserStatsCached()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}
