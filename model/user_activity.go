package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// ActiveUserStats 站点用户活跃度统计（基于消费日志）
type ActiveUserStats struct {
	ActiveUsers1h     int    `json:"active_users_1h"`     // 近 1 小时调用次数 >=10 的活跃人数（全站展示）
	Users1h           int    `json:"users_1h"`            // 近 1 小时有调用的人数
	Users24h          int    `json:"users_24h"`           // 近 24 小时有调用的人数
	ActiveUsers24h    int    `json:"active_users_24h"`    // 近 24 小时调用次数 >=10 的人数
	YesterdayTopUser  string `json:"yesterday_top_user"`  // 北京时间前一天调用次数最多的用户名
	YesterdayTopCalls int64  `json:"yesterday_top_calls"` // 北京时间前一天调用次数最多用户的调用次数
	RichestUser       string `json:"richest_user"`        // 普通用户中当前额度最高的用户名
	RichestUserQuota  int    `json:"richest_user_quota"`  // 普通用户中当前最高额度
}

// activeThreshold 视为“活跃/高频”的调用次数阈值（包含该值）
const activeThreshold = 10

// countDistinctUsers 统计指定时间戳之后有消费日志的去重用户数
func countDistinctUsers(since int64) (int, error) {
	var count int64
	err := LOG_DB.Model(&Log{}).
		Where("type = ? AND user_id > 0 AND created_at >= ?", LogTypeConsume, since).
		Distinct("user_id").
		Count(&count).Error
	return int(count), err
}

// countUsersWithMinCalls 统计指定时间戳之后调用次数 >= threshold 的去重用户数
func countUsersWithMinCalls(since int64, threshold int) (int, error) {
	var count int64
	sub := LOG_DB.Model(&Log{}).
		Select("user_id").
		Where("type = ? AND user_id > 0 AND created_at >= ?", LogTypeConsume, since).
		Group("user_id").
		Having("COUNT(*) >= ?", threshold)
	err := LOG_DB.Table("(?) as t", sub).Count(&count).Error
	return int(count), err
}

// getYesterdayTopCaller 获取北京时间前一天消费日志调用次数最多的用户
func getYesterdayTopCaller() (username string, calls int64, err error) {
	beijing, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return "", 0, err
	}
	now := time.Now().In(beijing)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, beijing)
	start := todayStart.AddDate(0, 0, -1).Unix()
	end := todayStart.Unix()

	var result struct {
		Username string
		Calls    int64
	}
	query := LOG_DB.Model(&Log{}).
		Select("username, COUNT(*) AS calls").
		Where("type = ? AND user_id > 0 AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end)
	if setting.ExcludeAdminAndRootFromRankings() {
		var excludedUserIDs []int
		if err = DB.Model(&User{}).
			Where("id = ? OR role >= ?", 1, common.RoleAdminUser).
			Pluck("id", &excludedUserIDs).Error; err != nil {
			return "", 0, err
		}
		if len(excludedUserIDs) > 0 {
			query = query.Where("user_id NOT IN ?", excludedUserIDs)
		}
	}
	err = query.Group("user_id, username").
		Order("calls DESC").
		Limit(1).
		Scan(&result).Error
	return result.Username, result.Calls, err
}

// getRichestUser 获取当前额度最高的用户。
func getRichestUser() (username string, quota int, err error) {
	var result struct {
		Username string
		Quota    int
	}
	query := DB.Model(&User{}).Select("username, quota")
	if setting.ExcludeAdminAndRootFromRankings() {
		query = query.Where("id <> ? AND role < ?", 1, common.RoleAdminUser)
	}
	err = query.Order("quota DESC").
		Limit(1).
		Scan(&result).Error
	return result.Username, result.Quota, err
}

// GetActiveUserStats 汇总站点用户活跃度指标
func GetActiveUserStats() (ActiveUserStats, error) {
	var stats ActiveUserStats
	now := time.Now()
	since1h := now.Add(-1 * time.Hour).Unix()
	since24h := now.Add(-24 * time.Hour).Unix()

	var err error
	if stats.ActiveUsers1h, err = countUsersWithMinCalls(since1h, activeThreshold); err != nil {
		return stats, err
	}
	if stats.Users1h, err = countDistinctUsers(since1h); err != nil {
		return stats, err
	}
	if stats.Users24h, err = countDistinctUsers(since24h); err != nil {
		return stats, err
	}
	if stats.ActiveUsers24h, err = countUsersWithMinCalls(since24h, activeThreshold); err != nil {
		return stats, err
	}
	if stats.YesterdayTopUser, stats.YesterdayTopCalls, err = getYesterdayTopCaller(); err != nil {
		return stats, err
	}
	if stats.RichestUser, stats.RichestUserQuota, err = getRichestUser(); err != nil {
		return stats, err
	}
	return stats, nil
}
