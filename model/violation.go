package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type ViolationEntry struct {
	Id                      int    `json:"id"`
	UserId                  int    `json:"user_id" gorm:"column:user_id;uniqueIndex"`
	ReasonCode              string `json:"reason_code" gorm:"column:reason_code;type:varchar(32)"`
	ReasonText              string `json:"reason_text" gorm:"column:reason_text;type:varchar(200)"`
	HitCount                int    `json:"hit_count" gorm:"column:hit_count;default:1"`
	ClientUA                string `json:"client_ua" gorm:"column:client_ua;type:varchar(255)"` // 违规客户端 User-Agent 筛选值，用于统计使用次数
	FirstRecordedAt         int64  `json:"first_recorded_at" gorm:"column:first_recorded_at;index"`
	LastRecordedAt          int64  `json:"last_recorded_at" gorm:"column:last_recorded_at;index"`
	Listed                  bool   `json:"listed" gorm:"column:listed;default:false;index"`
	DiscordIdSnapshot       string `json:"discord_id_snapshot" gorm:"column:discord_id_snapshot"`
	DiscordNameSnapshot     string `json:"discord_name_snapshot" gorm:"column:discord_name_snapshot"`
	DiscordUsernameSnapshot string `json:"discord_username_snapshot" gorm:"column:discord_username_snapshot"`
	DiscordAvatarSnapshot   string `json:"discord_avatar_snapshot" gorm:"column:discord_avatar_snapshot"`
	CreatedBy               int    `json:"created_by" gorm:"column:created_by"`
	UpdatedBy               int    `json:"updated_by" gorm:"column:updated_by"`
	RemovedBy               int    `json:"removed_by" gorm:"column:removed_by"`
	RemovedAt               int64  `json:"removed_at" gorm:"column:removed_at"`
}

func isProtectedViolationUser(userId, role int) bool {
	return userId == 1 || role >= common.RoleAdminUser
}

func UpsertViolationWithTx(tx *gorm.DB, userId int, reasonCode, reasonText string, listed, incrementHit bool, operatorId int, clientUA string) (bool, error) {
	var user User
	if err := tx.Select("id", "role", "discord_id", "discord_username", "discord_global_name", "discord_avatar").First(&user, userId).Error; err != nil {
		return false, err
	}
	if isProtectedViolationUser(user.Id, user.Role) {
		return false, errors.New("cannot add protected user to violation board")
	}

	now := common.GetTimestamp()
	var entry ViolationEntry
	err := tx.Where("user_id = ?", userId).First(&entry).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		entry = ViolationEntry{
			UserId:                  userId,
			ReasonCode:              reasonCode,
			ReasonText:              reasonText,
			HitCount:                1,
			ClientUA:                clientUA,
			FirstRecordedAt:         now,
			LastRecordedAt:          now,
			Listed:                  listed,
			DiscordIdSnapshot:       user.DiscordId,
			DiscordNameSnapshot:     user.DiscordGlobalName,
			DiscordUsernameSnapshot: user.DiscordUsername,
			DiscordAvatarSnapshot:   user.DiscordAvatar,
			CreatedBy:               operatorId,
			UpdatedBy:               operatorId,
		}
		return listed, tx.Create(&entry).Error
	}
	if err != nil {
		return false, err
	}
	updates := map[string]interface{}{
		"reason_code":               reasonCode,
		"reason_text":               reasonText,
		"last_recorded_at":          now,
		"listed":                    listed,
		"discord_id_snapshot":       user.DiscordId,
		"discord_name_snapshot":     user.DiscordGlobalName,
		"discord_username_snapshot": user.DiscordUsername,
		"discord_avatar_snapshot":   user.DiscordAvatar,
		"updated_by":                operatorId,
		"removed_by":                0,
		"removed_at":                0,
	}
	// 仅当本次带上了客户端 UA 时才更新，避免手动更新覆盖为空
	if clientUA != "" {
		updates["client_ua"] = clientUA
	}
	if incrementHit {
		updates["hit_count"] = gorm.Expr("hit_count + ?", 1)
	}
	return listed, tx.Model(&entry).Updates(updates).Error
}

func UpsertViolation(userId int, reasonCode, reasonText string, listed, incrementHit bool, operatorId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		_, err := UpsertViolationWithTx(tx, userId, reasonCode, reasonText, listed, incrementHit, operatorId, "")
		return err
	})
}

func RemoveViolation(userId, operatorId int) error {
	var user User
	if err := DB.Select("id", "role").First(&user, userId).Error; err != nil {
		return err
	}
	if isProtectedViolationUser(user.Id, user.Role) {
		return errors.New("cannot remove protected user from violation board")
	}
	return DB.Model(&ViolationEntry{}).Where("user_id = ?", userId).Updates(map[string]interface{}{
		"listed":     false,
		"removed_by": operatorId,
		"removed_at": common.GetTimestamp(),
		"updated_by": operatorId,
	}).Error
}
