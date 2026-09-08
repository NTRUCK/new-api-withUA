package service

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
)

// 邀请码校验相关错误。调用方按需映射为 i18n 文案返回给用户。
var (
	// ErrAffCodeRequired 开启强制邀请码后，注册请求未携带邀请码
	ErrAffCodeRequired = errors.New("aff code required")
	// ErrAffCodeInvalid 邀请码不存在，或邀请人不在邀请白名单内
	ErrAffCodeInvalid = errors.New("aff code invalid")
	// ErrAffInviteLimitReached 邀请人已达到邀请人数上限
	ErrAffInviteLimitReached = errors.New("aff invite limit reached")
)

// IsAffInviterWhitelisted 判断指定用户是否拥有邀请权限。
// 白名单为换行分隔的用户 ID 列表，同时兼容逗号分隔。
func IsAffInviterWhitelisted(userId int) bool {
	if userId <= 0 {
		return false
	}
	target := strconv.Itoa(userId)
	for _, line := range strings.Split(common.AffInviterWhitelist, "\n") {
		for _, item := range strings.Split(line, ",") {
			if strings.TrimSpace(item) == target {
				return true
			}
		}
	}
	return false
}

// ResolveInviterByAffCode 解析注册请求携带的邀请码，返回邀请人用户 ID。
//
// 未开启 AffCodeRequiredForRegister 时保持原有宽松行为：解析失败返回 0 且不报错，
// 让注册继续进行（此时邀请码仅用于发放奖励）。
// 开启后邀请码成为注册硬门槛：必须存在、邀请人必须在白名单内、且未超过邀请人数上限。
func ResolveInviterByAffCode(affCode string) (int, error) {
	affCode = strings.TrimSpace(affCode)
	required := common.AffCodeRequiredForRegister

	if affCode == "" {
		if required {
			return 0, ErrAffCodeRequired
		}
		return 0, nil
	}

	inviterId, err := model.GetUserIdByAffCode(affCode)
	if err != nil || inviterId <= 0 {
		if required {
			return 0, ErrAffCodeInvalid
		}
		return 0, nil
	}

	if !required {
		return inviterId, nil
	}

	if !IsAffInviterWhitelisted(inviterId) {
		return 0, ErrAffCodeInvalid
	}

	if common.MaxAffInviteCount > 0 {
		inviter, err := model.GetUserById(inviterId, false)
		if err != nil {
			return 0, ErrAffCodeInvalid
		}
		if inviter.AffCount >= common.MaxAffInviteCount {
			return 0, ErrAffInviteLimitReached
		}
	}

	return inviterId, nil
}

// AffCodeErrorI18nKey 把邀请码校验错误映射为 i18n 消息 key。
func AffCodeErrorI18nKey(err error) string {
	switch {
	case errors.Is(err, ErrAffCodeRequired):
		return i18n.MsgUserAffCodeRequired
	case errors.Is(err, ErrAffInviteLimitReached):
		return i18n.MsgUserAffInviteLimitReached
	default:
		return i18n.MsgUserAffCodeInvalid
	}
}
