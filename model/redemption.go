package model

import (
	"errors"
	"fmt"
	"math/rand"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

type Redemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
	MaxUses      int            `json:"max_uses" gorm:"default:1"`  // 最大可兑换次数，<=0 视为 1
	UsedCount    int            `json:"used_count" gorm:"default:0"` // 已兑换次数
	Mode         int            `json:"mode" gorm:"default:1"`       // 额度发放模式：1 固定 2 区间随机 3 拼手气红包
	MinQuota     int            `json:"min_quota" gorm:"default:0"`  // 区间随机模式下的最小额度
	MaxQuota     int            `json:"max_quota" gorm:"default:0"`  // 区间随机模式下的最大额度
	TotalQuota   int            `json:"total_quota" gorm:"default:0"` // 拼手气模式下的总额度
	RemainQuota  int            `json:"remain_quota" gorm:"default:0"` // 拼手气模式下剩余可发放额度
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Build query based on keyword type
	query := tx.Model(&Redemption{})

	// Only try to convert to ID if the string represents a valid integer
	if id, err := strconv.Atoi(keyword); err == nil {
		query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
	} else {
		query = query.Where("name LIKE ?", keyword+"%")
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, errors.New("未提供兑换码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	redemption := &Redemption{}

	keyCol := "`key`"
	if common.UsingPostgreSQL {
		keyCol = `"key"`
	}
	var awardedQuota int
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			return errors.New("无效的兑换码")
		}
		if redemption.Status == common.RedemptionCodeStatusDisabled {
			return errors.New("该兑换码已被禁用")
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return errors.New("该兑换码已被使用")
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return errors.New("该兑换码已过期")
		}
		// 兼容历史数据：MaxUses<=0 视为单次
		maxUses := redemption.MaxUses
		if maxUses <= 0 {
			maxUses = 1
		}
		if redemption.UsedCount >= maxUses {
			return errors.New("该兑换码已达到最大兑换次数")
		}

		remainingUses := maxUses - redemption.UsedCount
		awardedQuota = computeRedeemQuota(redemption, remainingUses)
		if awardedQuota < 0 {
			awardedQuota = 0
		}

		if err = tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", awardedQuota)).Error; err != nil {
			return err
		}
		redemption.RedeemedTime = common.GetTimestamp()
		redemption.UsedCount++
		redemption.UsedUserId = userId
		if redemption.Mode == common.RedemptionModeLuckyPacket {
			redemption.RemainQuota -= awardedQuota
			if redemption.RemainQuota < 0 {
				redemption.RemainQuota = 0
			}
		}
		// 达到最大次数则标记为已使用，否则保持启用以便复用
		if redemption.UsedCount >= maxUses {
			redemption.Status = common.RedemptionCodeStatusUsed
		}
		err = tx.Model(redemption).Select("redeemed_time", "used_count", "used_user_id", "status", "remain_quota").Updates(redemption).Error
		return err
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		return 0, ErrRedeemFailed
	}
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(awardedQuota), redemption.Id))
	return awardedQuota, nil
}

// computeRedeemQuota 根据兑换码发放模式计算本次实际发放额度。
// remainingUses 为包含本次在内的剩余可兑换次数（>=1）。
func computeRedeemQuota(redemption *Redemption, remainingUses int) int {
	switch redemption.Mode {
	case common.RedemptionModeRandomRange:
		min := redemption.MinQuota
		max := redemption.MaxQuota
		if max <= min {
			return min
		}
		return min + rand.Intn(max-min+1)
	case common.RedemptionModeLuckyPacket:
		remain := redemption.RemainQuota
		if remain <= 0 {
			return 0
		}
		if remainingUses <= 1 {
			// 最后一份，把剩余全部发出
			return remain
		}
		// 微信拼手气算法：本次随机范围 [1, remain/remainingUses*2]，保证后续每份至少 1
		max := remain - (remainingUses - 1)
		if max <= 1 {
			return 1
		}
		limit := remain / remainingUses * 2
		if limit < 1 {
			limit = 1
		}
		if limit > max {
			limit = max
		}
		return 1 + rand.Intn(limit)
	default:
		return redemption.Quota
	}
}

func (redemption *Redemption) Insert() error {
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	var err error
	err = DB.Model(redemption).Select("name", "status", "quota", "redeemed_time", "expired_time", "max_uses", "mode", "min_quota", "max_quota", "total_quota", "remain_quota").Updates(redemption).Error
	return err
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
