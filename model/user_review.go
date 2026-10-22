/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"gorm.io/gorm"
)

// 注册审核申请状态。
// 待审核固定为 0：既是 GORM 零值，也是数据库列默认值，无需额外赋值。
const (
	UserReviewStatusPending  = 0 // 待审核
	UserReviewStatusApproved = 1 // 已通过
)

// UserReview 注册审核申请。
//
// 开启注册审核后，新用户注册不会直接创建 users 记录，而是先落一条申请，
// 审核通过后才真正建号。未通过审核的用户在 users 表中不存在，因此天然无法登录，
// 无需改动任何登录/鉴权逻辑；驳回时删除申请记录，申请人可重新注册。
type UserReview struct {
	Id         int    `json:"id"`
	Username   string `json:"username" gorm:"column:username;type:varchar(64);index"`
	Password   string `json:"-" gorm:"column:password;type:varchar(128)"` // 已哈希，审核通过后直接写入 users
	Email      string `json:"email" gorm:"column:email;type:varchar(128);index"`
	Reason     string `json:"reason" gorm:"column:reason;type:varchar(500)"`
	Contact    string `json:"contact" gorm:"column:contact;type:varchar(128)"`
	InviterId  int    `json:"inviter_id" gorm:"column:inviter_id"`
	Status     int    `json:"status" gorm:"column:status;default:0;index"`
	ReviewedBy int    `json:"reviewed_by" gorm:"column:reviewed_by"`
	ReviewedAt int64  `json:"reviewed_at" gorm:"column:reviewed_at"`
	UserId     int    `json:"user_id" gorm:"column:user_id"` // 审核通过后关联的用户 ID
	ClientIp   string `json:"client_ip" gorm:"column:client_ip;type:varchar(64);index"`
	CreatedAt  int64  `json:"created_at" gorm:"column:created_at;index"`
}

// Insert 写入申请，密码在此处哈希，避免明文落库。
func (r *UserReview) Insert() error {
	if r.Password != "" {
		hashed, err := common.Password2Hash(r.Password)
		if err != nil {
			return err
		}
		r.Password = hashed
	}
	r.CreatedAt = common.GetTimestamp()
	return DB.Create(r).Error
}

// GetLatestUserReviewByUsername 查询某用户名最新的申请记录，供申请人自助查看进度。
func GetLatestUserReviewByUsername(username string) (*UserReview, error) {
	var review UserReview
	err := DB.Where("username = ?", username).Order("id DESC").First(&review).Error
	if err != nil {
		return nil, err
	}
	return &review, nil
}

// CheckPendingUserReviewExist 检查是否已存在同用户名或邮箱的待审核申请，避免重复提交。
func CheckPendingUserReviewExist(username string, email string) (bool, error) {
	query := DB.Model(&UserReview{}).Where("status = ?", UserReviewStatusPending)
	if email == "" {
		query = query.Where("username = ?", username)
	} else {
		query = query.Where("username = ? OR email = ?", username, email)
	}
	var review UserReview
	err := query.First(&review).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// GetUserReviews 分页查询申请列表。status 传 -1 表示不筛选，keyword 支持用户名/邮箱/联系方式模糊匹配。
func GetUserReviews(pageInfo *common.PageInfo, status int, keyword string) ([]*UserReview, int64, error) {
	build := func() *gorm.DB {
		query := DB.Model(&UserReview{})
		if status >= 0 {
			query = query.Where("status = ?", status)
		}
		if keyword != "" {
			like := "%" + keyword + "%"
			query = query.Where("username LIKE ? OR email LIKE ? OR contact LIKE ?", like, like, like)
		}
		return query
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var reviews []*UserReview
	// 待审核排在最前，其余按提交时间倒序
	err := build().Order("status ASC, id DESC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&reviews).Error
	if err != nil {
		return nil, 0, err
	}
	return reviews, total, nil
}

// GetUserReviewById 按 ID 查询申请。
func GetUserReviewById(id int) (*UserReview, error) {
	var review UserReview
	if err := DB.Where("id = ?", id).First(&review).Error; err != nil {
		return nil, err
	}
	return &review, nil
}

// ApproveUserReview 批准申请：事务内建号并回写申请状态。
// 事务提交后再执行边栏初始化、注册赠送与邀请奖励等收尾工作。
func ApproveUserReview(reviewId int, reviewerId int) (*User, error) {
	review, err := GetUserReviewById(reviewId)
	if err != nil {
		return nil, err
	}
	if review.Status != UserReviewStatusPending {
		return nil, errors.New("该申请已被处理")
	}

	user := &User{
		Username:    review.Username,
		Password:    review.Password, // 申请阶段已哈希，此处不再二次加密
		DisplayName: review.Username,
		Email:       review.Email,
		InviterId:   review.InviterId,
		Role:        common.RoleCommonUser,
	}

	tx := DB.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	user.Quota = common.QuotaForNewUser
	user.AffCode = generateUniqueAffCodeWithTx(tx)
	if user.Setting == "" {
		user.SetSetting(dto.UserSetting{})
	}
	if err := tx.Create(user).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	if err := tx.Model(&UserReview{}).Where("id = ?", reviewId).Updates(map[string]interface{}{
		"status":      UserReviewStatusApproved,
		"reviewed_by": reviewerId,
		"reviewed_at": common.GetTimestamp(),
		"user_id":     user.Id,
	}).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	user.FinalizeOAuthUserCreation(review.InviterId)
	return user, nil
}

// DeleteUserReview 删除待审核申请（驳回）。申请人可随后重新注册申请。
func DeleteUserReview(reviewId int) error {
	result := DB.Where("id = ? AND status = ?", reviewId, UserReviewStatusPending).Delete(&UserReview{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("该申请不存在或已被处理")
	}
	return nil
}

// CountRecentUserReviewsByIp 统计同一 IP 在指定时间戳之后提交的申请数，用于限频。
func CountRecentUserReviewsByIp(clientIp string, since int64) (int64, error) {
	var count int64
	err := DB.Model(&UserReview{}).
		Where("client_ip = ? AND created_at >= ?", clientIp, since).
		Count(&count).Error
	return count, err
}

// CountPendingUserReviews 待审核申请数，用于审核入口角标。
func CountPendingUserReviews() (int64, error) {
	var count int64
	err := DB.Model(&UserReview{}).
		Where("status = ?", UserReviewStatusPending).
		Count(&count).Error
	return count, err
}
