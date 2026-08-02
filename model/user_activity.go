package model

import (
	"time"
)

// ActiveUserStats 站点用户活跃度统计（基于消费日志）
type ActiveUserStats struct {
	ActiveUsers1h    int `json:"active_users_1h"`     // 近 1 小时调用次数 >=10 的活跃人数（全站展示）
	Users1h          int `json:"users_1h"`            // 近 1 小时有调用的人数
	Users24h         int `json:"users_24h"`           // 近 24 小时有调用的人数
	ActiveUsers24h   int `json:"active_users_24h"`    // 近 24 小时调用次数 >=10 的人数
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
	return stats, nil
}
