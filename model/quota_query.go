package model

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type QuotaQueryDailySlot struct {
	Id          int64  `gorm:"primaryKey;autoIncrement"`
	RequesterId int    `gorm:"not null;uniqueIndex:idx_quota_query_slot"`
	QueryDate   string `gorm:"type:varchar(10);not null;uniqueIndex:idx_quota_query_slot"`
	Slot        int    `gorm:"not null;uniqueIndex:idx_quota_query_slot"`
	CreatedAt   int64  `gorm:"bigint;not null"`
}

type QuotaQueryRecord struct {
	Id             int64  `gorm:"primaryKey;autoIncrement"`
	RequesterId    int    `gorm:"not null;index"`
	QueryDate      string `gorm:"type:varchar(10);not null;index"`
	TargetUserId   int    `gorm:"not null;index"`
	TargetUsername string `gorm:"type:varchar(64);not null"`
	TargetQuota    int    `gorm:"not null"`
	Fee            int    `gorm:"not null"`
	RequesterAfter int    `gorm:"not null"`
	CreatedAt      int64  `gorm:"bigint;not null;index"`
}

type QuotaQueryResult struct {
	TargetUserId   int    `json:"target_user_id"`
	TargetUsername string `json:"target_username"`
	Quota          int    `json:"quota"`
	Fee            int    `json:"fee"`
	Balance        int    `json:"balance"`
	UsedToday      int    `json:"used_today"`
	RemainingToday int    `json:"remaining_today"`
}

func quotaQueryDate() string {
	return time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
}

func GetQuotaQueryStatus(userId int) (map[string]interface{}, error) {
	setting := operation_setting.GetQuotaQuerySetting()
	var used int64
	if err := DB.Model(&QuotaQueryRecord{}).Where("requester_id = ? AND query_date = ?", userId, quotaQueryDate()).Count(&used).Error; err != nil {
		return nil, err
	}
	remaining := 0
	if setting.DailyLimit > 0 {
		remaining = setting.DailyLimit - int(used)
		if remaining < 0 {
			remaining = 0
		}
	}
	return map[string]interface{}{
		"enabled": setting.Enabled, "fee": setting.Fee, "daily_limit": setting.DailyLimit,
		"used_today": used, "remaining_today": remaining,
	}, nil
}

func QueryUserQuota(requesterId int, queryType, value string) (*QuotaQueryResult, error) {
	setting := operation_setting.GetQuotaQuerySetting()
	if !setting.Enabled {
		return nil, errors.New("额度查询功能未启用")
	}
	if setting.Fee < 0 || setting.DailyLimit < 0 {
		return nil, errors.New("额度查询配置无效")
	}
	value = strings.TrimSpace(value)
	if value == "" || (queryType != "id" && queryType != "username") {
		return nil, errors.New("查询参数无效")
	}

	date := quotaQueryDate()
	var result QuotaQueryResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		var target User
		query := tx.Select("id", "username", "role", "quota")
		if !setting.AllowAdminAndRoot {
			query = query.Where("id <> ? AND role < ?", 1, common.RoleAdminUser)
		}
		if queryType == "id" {
			id, err := strconv.Atoi(value)
			if err != nil || id <= 0 {
				return errors.New("未找到可查询的用户")
			}
			query = query.Where("id = ?", id)
		} else {
			query = query.Where("username = ?", value)
		}
		if err := query.First(&target).Error; err != nil {
			return errors.New("未找到可查询的用户")
		}

		if setting.DailyLimit > 0 {
			acquired := false
			for slot := 1; slot <= setting.DailyLimit; slot++ {
				row := QuotaQueryDailySlot{RequesterId: requesterId, QueryDate: date, Slot: slot, CreatedAt: time.Now().Unix()}
				created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
				if created.Error != nil {
					return created.Error
				}
				if created.RowsAffected == 1 {
					acquired = true
					break
				}
			}
			if !acquired {
				return errors.New("今日查询次数已用完")
			}
		}

		if setting.Fee > 0 {
			debit := tx.Model(&User{}).Where("id = ? AND quota >= ?", requesterId, setting.Fee).UpdateColumn("quota", gorm.Expr("quota - ?", setting.Fee))
			if debit.Error != nil || debit.RowsAffected == 0 {
				return errors.New("额度不足")
			}
			if err := tx.FirstOrCreate(&DiceWelfarePool{}, DiceWelfarePool{Id: 1}).Error; err != nil {
				return err
			}
			if err := tx.Model(&DiceWelfarePool{}).Where("id = ?", 1).Updates(map[string]interface{}{"quota": gorm.Expr("quota + ?", setting.Fee), "updated_at": time.Now().Unix()}).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(&User{}).Where("id = ?", requesterId).Select("quota").Scan(&result.Balance).Error; err != nil {
			return err
		}
		record := QuotaQueryRecord{RequesterId: requesterId, QueryDate: date, TargetUserId: target.Id, TargetUsername: target.Username, TargetQuota: target.Quota, Fee: setting.Fee, RequesterAfter: result.Balance, CreatedAt: time.Now().Unix()}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		result.TargetUserId = target.Id
		result.TargetUsername = target.Username
		result.Quota = target.Quota
		result.Fee = setting.Fee
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := updateUserQuotaCache(requesterId, result.Balance); err != nil {
		common.SysLog("failed to update user quota cache after quota query: " + err.Error())
	}
	var used int64
	_ = DB.Model(&QuotaQueryRecord{}).Where("requester_id = ? AND query_date = ?", requesterId, date).Count(&used).Error
	result.UsedToday = int(used)
	if setting.DailyLimit > 0 {
		result.RemainingToday = setting.DailyLimit - result.UsedToday
		if result.RemainingToday < 0 {
			result.RemainingToday = 0
		}
	}
	return &result, nil
}
