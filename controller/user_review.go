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

package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// checkReviewPermission 校验当前登录用户是否可执行审核操作：审核员白名单或管理员。
func checkReviewPermission(c *gin.Context) bool {
	if service.IsRegisterReviewAdmin(c.GetInt("id"), c.GetInt("role")) {
		return true
	}
	common.ApiErrorI18n(c, i18n.MsgUserReviewForbidden)
	return false
}

// GetUserReviewSummary 返回当前用户是否有审核权限与待审核数量，供前端决定是否展示审核入口。
func GetUserReviewSummary(c *gin.Context) {
	canReview := service.IsRegisterReviewAdmin(c.GetInt("id"), c.GetInt("role"))
	var pending int64
	if canReview {
		if count, err := model.CountPendingUserReviews(); err == nil {
			pending = count
		}
	}
	common.ApiSuccess(c, gin.H{
		"can_review":     canReview,
		"pending_count":  pending,
		"review_enabled": common.RegisterReviewEnabled,
	})
}

// GetUserReviewStatus 申请人自助查询审核进度。
//
// 该接口无需登录（申请人此时尚无账号），仅返回状态与时间，不暴露申请内容与联系方式。
func GetUserReviewStatus(c *gin.Context) {
	username := strings.TrimSpace(c.Query("username"))
	if username == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	review, err := model.GetLatestUserReviewByUsername(username)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserReviewNotFound)
		return
	}
	common.ApiSuccess(c, gin.H{
		"username":    review.Username,
		"status":      review.Status,
		"created_at":  review.CreatedAt,
		"reviewed_at": review.ReviewedAt,
	})
}

// GetUserReviews 分页查询申请列表。status 为空表示不筛选。
func GetUserReviews(c *gin.Context) {
	if !checkReviewPermission(c) {
		return
	}
	status := -1
	if raw := strings.TrimSpace(c.Query("status")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			status = v
		}
	}
	keyword := strings.TrimSpace(c.Query("keyword"))

	pageInfo := common.GetPageQuery(c)
	reviews, total, err := model.GetUserReviews(pageInfo, status, keyword)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(reviews)
	common.ApiSuccess(c, pageInfo)
}

// ApproveUserReview 批准申请：创建用户账号并回写审核状态。
func ApproveUserReview(c *gin.Context) {
	if !checkReviewPermission(c) {
		return
	}
	reviewId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	user, err := model.ApproveUserReview(reviewId, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"user_id":  user.Id,
		"username": user.Username,
	})
}

// RejectUserReview 驳回申请：删除申请记录，申请人可重新注册申请。
func RejectUserReview(c *gin.Context) {
	if !checkReviewPermission(c) {
		return
	}
	reviewId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.DeleteUserReview(reviewId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetUserReviewDiscord 查询申请人的 Discord 服务器与身份组信息。
func GetUserReviewDiscord(c *gin.Context) {
	if !checkReviewPermission(c) {
		return
	}
	reviewId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if strings.TrimSpace(common.RegisterReviewDiscordBotToken) == "" ||
		len(service.GetRegisterReviewDiscordGuildIds()) == 0 {
		common.ApiErrorI18n(c, i18n.MsgUserReviewDiscordNotConfigured)
		return
	}
	review, err := model.GetUserReviewById(reviewId)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserReviewNotFound)
		return
	}
	result, err := service.LookupDiscordApplicant(review.Contact)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserReviewDiscordLookupFailed)
		return
	}
	common.ApiSuccess(c, result)
}
