package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type violationRequest struct {
	UserId       int    `json:"user_id"`
	ReasonCode   string `json:"reason_code"`
	ReasonText   string `json:"reason_text"`
	ListPublicly bool   `json:"list_publicly"`
	IncrementHit bool   `json:"increment_hit"`
}

func normalizeViolationReason(code, text string) (string, string, error) {
	switch code {
	case "tavo_client":
		return code, "TAVO 客户端", nil
	case "custom":
		text = strings.Map(func(r rune) rune {
			if r == 0 || unicode.IsControl(r) {
				return -1
			}
			return r
		}, text)
		text = strings.TrimSpace(text)
		length := utf8.RuneCountInString(text)
		if length < 1 || length > 200 {
			return "", "", errors.New("reason_text must be 1-200 characters")
		}
		return code, text, nil
	default:
		return "", "", errors.New("invalid reason_code")
	}
}

func AdminUpsertViolation(c *gin.Context) {
	var req violationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	code, text, err := normalizeViolationReason(req.ReasonCode, req.ReasonText)
	if err != nil || req.UserId <= 0 {
		if err == nil {
			err = errors.New("invalid user_id")
		}
		common.ApiError(c, err)
		return
	}
	if err := model.UpsertViolation(req.UserId, code, text, req.ListPublicly, req.IncrementHit, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLogWithAdminInfo(req.UserId, model.LogTypeManage, "管理员更新违规记录", gin.H{
		"admin_id": c.GetInt("id"), "admin_username": c.GetString("username"), "listed": req.ListPublicly,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func AdminRemoveViolation(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("user_id"))
	if err != nil || userId <= 0 {
		common.ApiError(c, errors.New("invalid user_id"))
		return
	}
	if err := model.RemoveViolation(userId, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLogWithAdminInfo(userId, model.LogTypeManage, "管理员撤下违规记录", gin.H{
		"admin_id": c.GetInt("id"), "admin_username": c.GetString("username"),
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

type publicViolationItem struct {
	UserId          int    `json:"user_id"`
	DisplayName     string `json:"display_name"`
	DiscordUsername string `json:"discord_username"`
	AvatarURL       string `json:"avatar_url"`
	Reason          string `json:"reason"`
	HitCount        int    `json:"hit_count"`
	FirstRecordedAt int64  `json:"first_recorded_at"`
	LastRecordedAt  int64  `json:"last_recorded_at"`
}

type publicViolationRow struct {
	UserId                  int
	DisplayName             string
	DiscordIdSnapshot       string
	DiscordNameSnapshot     string
	DiscordUsernameSnapshot string
	DiscordAvatarSnapshot   string
	ReasonText              string
	HitCount                int
	FirstRecordedAt         int64
	LastRecordedAt          int64
}

func discordAvatarURL(discordId, avatarHash string) string {
	if discordId != "" && avatarHash != "" {
		ext := "png"
		if strings.HasPrefix(avatarHash, "a_") {
			ext = "gif"
		}
		return fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.%s", discordId, avatarHash, ext)
	}
	if discordId == "" {
		return "https://cdn.discordapp.com/embed/avatars/0.png"
	}
	id, err := strconv.ParseUint(discordId, 10, 64)
	if err != nil {
		return "https://cdn.discordapp.com/embed/avatars/0.png"
	}
	return fmt.Sprintf("https://cdn.discordapp.com/embed/avatars/%d.png", (id>>22)%6)
}

func GetPublicViolations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := model.DB.Model(&model.ViolationEntry{}).Where("listed = ?", true)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var rows []publicViolationRow
	if err := query.Select("violation_entries.user_id, users.display_name, violation_entries.discord_id_snapshot, violation_entries.discord_name_snapshot, violation_entries.discord_username_snapshot, violation_entries.discord_avatar_snapshot, violation_entries.reason_text, violation_entries.hit_count, violation_entries.first_recorded_at, violation_entries.last_recorded_at").
		Joins("LEFT JOIN users ON users.id = violation_entries.user_id").Order("violation_entries.last_recorded_at DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Scan(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]publicViolationItem, 0, len(rows))
	for _, row := range rows {
		displayName := row.DiscordNameSnapshot
		if displayName == "" {
			displayName = row.DisplayName
		}
		items = append(items, publicViolationItem{
			UserId: row.UserId, DisplayName: displayName, DiscordUsername: row.DiscordUsernameSnapshot,
			AvatarURL: discordAvatarURL(row.DiscordIdSnapshot, row.DiscordAvatarSnapshot), Reason: row.ReasonText,
			HitCount: row.HitCount, FirstRecordedAt: row.FirstRecordedAt, LastRecordedAt: row.LastRecordedAt,
		})
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pageInfo})
}

type inactiveUserItem struct {
	Id               int    `json:"id"`
	Username         string `json:"username"`
	DisplayName      string `json:"display_name"`
	Status           int    `json:"status"`
	CreatedAt        int64  `json:"created_at"`
	LastLoginAt      int64  `json:"last_login_at"`
	OnViolationBoard bool   `json:"on_violation_board"`
}

func GetInactiveUsers(c *gin.Context) {
	start, err1 := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, err2 := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	now := time.Now().Unix()
	if err1 != nil || err2 != nil || start <= 0 || end <= 0 || start > end || end > now {
		common.ApiError(c, errors.New("invalid timestamp range"))
		return
	}
	inactiveIds, err := computeInactiveUserIds(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo := common.GetPageQuery(c)
	items := make([]inactiveUserItem, 0)
	if len(inactiveIds) > 0 {
		if err := model.DB.Model(&model.User{}).
			Select("users.id, users.username, users.display_name, users.status, users.created_at, users.last_login_at, CASE WHEN violation_entries.listed = ? THEN ? ELSE ? END AS on_violation_board", true, true, false).
			Joins("LEFT JOIN violation_entries ON violation_entries.user_id = users.id").Where("users.id IN ?", inactiveIds).
			Order("users.id DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Scan(&items).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiError(c, err)
			return
		}
	}
	pageInfo.SetTotal(len(inactiveIds))
	pageInfo.SetItems(items)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pageInfo})
}

// computeInactiveUserIds 返回在 [start, end] 时间段内没有调用日志的普通用户 ID（排除 User ID 1 和管理员）
func computeInactiveUserIds(start, end int64) ([]int, error) {
	var candidateIds []int
	if err := model.DB.Model(&model.User{}).Where("id <> ? AND role < ?", 1, common.RoleAdminUser).Pluck("id", &candidateIds).Error; err != nil {
		return nil, err
	}
	active := make(map[int]struct{})
	if len(candidateIds) > 0 {
		var activeIds []int
		if err := model.LOG_DB.Model(&model.Log{}).Distinct("user_id").Where("user_id IN ? AND created_at >= ? AND created_at <= ? AND type IN ?", candidateIds, start, end, []int{model.LogTypeConsume, model.LogTypeError}).Pluck("user_id", &activeIds).Error; err != nil {
			return nil, err
		}
		for _, id := range activeIds {
			active[id] = struct{}{}
		}
	}
	inactiveIds := make([]int, 0, len(candidateIds))
	for _, id := range candidateIds {
		if _, ok := active[id]; !ok {
			inactiveIds = append(inactiveIds, id)
		}
	}
	return inactiveIds, nil
}

type batchDisableInactiveRequest struct {
	StartTimestamp   int64                         `json:"start_timestamp"`
	EndTimestamp     int64                         `json:"end_timestamp"`
	Confirm          bool                          `json:"confirm"`
	WhitelistUserIds []int                         `json:"whitelist_user_ids"`
	Violation        *BatchDisableViolationRequest `json:"violation"`
}

// BatchDisableInactiveUsers 批量封禁在指定时间段内无调用的用户
func BatchDisableInactiveUsers(c *gin.Context) {
	var req batchDisableInactiveRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !req.Confirm {
		common.ApiError(c, errors.New("invalid params"))
		return
	}
	now := time.Now().Unix()
	if req.StartTimestamp <= 0 || req.EndTimestamp <= 0 || req.StartTimestamp > req.EndTimestamp || req.EndTimestamp > now {
		common.ApiError(c, errors.New("invalid timestamp range"))
		return
	}
	userIds, err := computeInactiveUserIds(req.StartTimestamp, req.EndTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	matchedCount := len(userIds)
	// 白名单：排除管理员本次勾选保护的用户，永不封禁
	whitelistedCount := 0
	if len(req.WhitelistUserIds) > 0 {
		whitelist := make(map[int]bool, len(req.WhitelistUserIds))
		for _, id := range req.WhitelistUserIds {
			whitelist[id] = true
		}
		filtered := make([]int, 0, len(userIds))
		for _, id := range userIds {
			if whitelist[id] {
				whitelistedCount++
				continue
			}
			filtered = append(filtered, id)
		}
		userIds = filtered
	}
	var violation *model.BatchDisableViolation
	if req.Violation != nil {
		code, text, normalizeErr := normalizeViolationReason(req.Violation.ReasonCode, req.Violation.ReasonText)
		if normalizeErr != nil {
			common.ApiError(c, normalizeErr)
			return
		}
		violation = &model.BatchDisableViolation{ReasonCode: code, ReasonText: text, ListPublicly: req.Violation.ListPublicly, OperatorId: c.GetInt("id")}
	}
	disabledIds, listedCount, err := model.BatchDisableUsersWithViolation(userIds, violation)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	adminInfo := map[string]interface{}{
		"admin_id":          c.GetInt("id"),
		"admin_username":    c.GetString("username"),
		"matched_count":     matchedCount,
		"disabled_count":    len(disabledIds),
		"listed_count":      listedCount,
		"whitelisted_count": whitelistedCount,
		"start_timestamp":   req.StartTimestamp,
		"end_timestamp":     req.EndTimestamp,
	}
	model.RecordLogWithAdminInfo(c.GetInt("id"), model.LogTypeManage, fmt.Sprintf("按无调用时间段批量封禁用户，共封禁 %d 个用户", len(disabledIds)), adminInfo)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"matched_count":     matchedCount,
			"disabled_count":    len(disabledIds),
			"listed_count":      listedCount,
			"whitelisted_count": whitelistedCount,
			"skipped_count":     matchedCount - len(disabledIds) - whitelistedCount,
		},
	})
}
