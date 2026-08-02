package controller

import (
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func GetAllRedemptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.GetAllRedemptions(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func SearchRedemptions(c *gin.Context) {
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.SearchRedemptions(keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetRedemption(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	redemption, err := model.GetRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    redemption,
	})
	return
}

func AddRedemption(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorI18n(c, i18n.MsgPaymentComplianceRequired)
		return
	}

	redemption := model.Redemption{}
	err := c.ShouldBindJSON(&redemption)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if utf8.RuneCountInString(redemption.Name) == 0 || utf8.RuneCountInString(redemption.Name) > 20 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionNameLength)
		return
	}
	if redemption.Count <= 0 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountPositive)
		return
	}
	if redemption.Count > 100 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountMax)
		return
	}
	if valid, msg := validateExpiredTime(c, redemption.ExpiredTime); !valid {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
		return
	}
	maxUses := redemption.MaxUses
	if maxUses <= 0 {
		maxUses = 1
	}
	// 校验发放模式相关参数
	mode := redemption.Mode
	if mode == 0 {
		mode = common.RedemptionModeFixed
	}
	switch mode {
	case common.RedemptionModeFixed:
		if redemption.Quota <= 0 {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
	case common.RedemptionModeRandomRange:
		if redemption.MinQuota < 0 || redemption.MaxQuota <= 0 || redemption.MaxQuota < redemption.MinQuota {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
	case common.RedemptionModeLuckyPacket:
		// 拼手气：总额度需 >= 份数（保证每份至少 1）
		if redemption.TotalQuota < maxUses {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
		// 可选每份下限/上限校验：min>=0，max>=0，min<=max（max=0 表示不限）
		if redemption.MinQuota < 0 || redemption.MaxQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
		if redemption.MaxQuota > 0 && redemption.MinQuota > redemption.MaxQuota {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
		// 可行性校验：份数 * 下限 <= 总额 <= 份数 * 上限
		floor := redemption.MinQuota
		if floor < 1 {
			floor = 1
		}
		if redemption.TotalQuota < floor*maxUses {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
		if redemption.MaxQuota > 0 && redemption.TotalQuota > redemption.MaxQuota*maxUses {
			common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
			return
		}
	default:
		common.ApiErrorI18n(c, i18n.MsgRedemptionModeParamInvalid)
		return
	}
	var keys []string
	for i := 0; i < redemption.Count; i++ {
		key := common.GetUUID()
		cleanRedemption := model.Redemption{
			UserId:      c.GetInt("id"),
			Name:        redemption.Name,
			Key:         key,
			CreatedTime: common.GetTimestamp(),
			Quota:       redemption.Quota,
			ExpiredTime: redemption.ExpiredTime,
			MaxUses:     maxUses,
			Mode:        mode,
			MinQuota:    redemption.MinQuota,
			MaxQuota:    redemption.MaxQuota,
			TotalQuota:  redemption.TotalQuota,
		}
		// 拼手气模式：每个码独立持有一份总额度与剩余额度
		if mode == common.RedemptionModeLuckyPacket {
			cleanRedemption.RemainQuota = redemption.TotalQuota
		}
		err = cleanRedemption.Insert()
		if err != nil {
			common.SysError("failed to insert redemption: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgRedemptionCreateFailed),
				"data":    keys,
			})
			return
		}
		keys = append(keys, key)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    keys,
	})
	return
}

func DeleteRedemption(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	err := model.DeleteRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateRedemption(c *gin.Context) {
	statusOnly := c.Query("status_only")
	redemption := model.Redemption{}
	err := c.ShouldBindJSON(&redemption)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cleanRedemption, err := model.GetRedemptionById(redemption.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		if valid, msg := validateExpiredTime(c, redemption.ExpiredTime); !valid {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
			return
		}
		// If you add more fields, please also update redemption.Update()
		cleanRedemption.Name = redemption.Name
		cleanRedemption.Quota = redemption.Quota
		cleanRedemption.ExpiredTime = redemption.ExpiredTime
		if redemption.MaxUses > 0 {
			// 不允许把上限改到小于已兑换次数
			if redemption.MaxUses < cleanRedemption.UsedCount {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": i18n.T(c, i18n.MsgRedemptionMaxUsesTooSmall)})
				return
			}
			cleanRedemption.MaxUses = redemption.MaxUses
		}
	}
	if statusOnly != "" {
		cleanRedemption.Status = redemption.Status
	}
	err = cleanRedemption.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanRedemption,
	})
	return
}

func DeleteInvalidRedemption(c *gin.Context) {
	rows, err := model.DeleteInvalidRedemptions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

func validateExpiredTime(c *gin.Context, expired int64) (bool, string) {
	if expired != 0 && expired < common.GetTimestamp() {
		return false, i18n.T(c, i18n.MsgRedemptionExpireTimeInvalid)
	}
	return true, ""
}
