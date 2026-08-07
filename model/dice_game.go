package model

import (
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DiceGameRecord 骰子猜大小游戏记录
type DiceGameRecord struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	Choice    string `json:"choice" gorm:"type:varchar(8);not null"`
	Bet       int    `json:"bet" gorm:"not null"`
	EntryFee  int    `json:"entry_fee" gorm:"not null"`
	Dice1     int    `json:"dice1" gorm:"not null"`
	Dice2     int    `json:"dice2" gorm:"not null"`
	Dice3     int    `json:"dice3" gorm:"not null"`
	Sum       int    `json:"sum" gorm:"not null"`
	IsTriple  bool   `json:"is_triple" gorm:"not null"`
	Win       bool   `json:"win" gorm:"not null"`
	Payout    int    `json:"payout" gorm:"not null"`
	NetChange int    `json:"net_change" gorm:"not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

func (DiceGameRecord) TableName() string { return "dice_game_records" }

// DiceWelfarePool 全站共享低保池，固定使用 ID 1。
type DiceWelfarePool struct {
	Id        int   `gorm:"primaryKey"`
	Quota     int64 `gorm:"not null;default:0"`
	UpdatedAt int64 `gorm:"bigint"`
}

func (DiceWelfarePool) TableName() string { return "dice_welfare_pools" }

// DiceWelfareClaim 低保领取记录，北京时间每天每位用户仅一条。
type DiceWelfareClaim struct {
	Id        int    `gorm:"primaryKey;autoIncrement"`
	UserId    int    `gorm:"uniqueIndex:idx_dice_welfare_user_date;not null"`
	ClaimDate string `gorm:"type:varchar(10);uniqueIndex:idx_dice_welfare_user_date;not null"`
	Quota     int    `gorm:"not null"`
	CreatedAt int64  `gorm:"bigint;index"`
}

func (DiceWelfareClaim) TableName() string { return "dice_welfare_claims" }

type DiceGameResult struct {
	Dice       [3]int `json:"dice"`
	Sum        int    `json:"sum"`
	IsTriple   bool   `json:"is_triple"`
	Win        bool   `json:"win"`
	Bet        int    `json:"bet"`
	Payout     int    `json:"payout"`
	NetChange  int    `json:"net_change"`
	Balance    int    `json:"balance"`
	PlaysToday int    `json:"plays_today"`
	PlaysLeft  int    `json:"plays_left"`
}

type DiceWelfareResult struct {
	Granted       int   `json:"granted"`
	Balance       int   `json:"balance"`
	PoolRemaining int64 `json:"pool_remaining"`
}

func countDiceGamePlaysToday(userId int) (int, error) {
	now := time.Now()
	resetHour := operation_setting.GetDiceGameSetting().DailyResetHour
	if resetHour < 0 || resetHour > 23 {
		resetHour = 0
	}
	y, m, d := now.Date()
	startOfPeriod := time.Date(y, m, d, resetHour, 0, 0, 0, now.Location())
	if now.Before(startOfPeriod) {
		startOfPeriod = startOfPeriod.AddDate(0, 0, -1)
	}
	var count int64
	err := DB.Model(&DiceGameRecord{}).Where("user_id = ? AND created_at >= ?", userId, startOfPeriod.Unix()).Count(&count).Error
	return int(count), err
}

func diceWelfareDate() string {
	return time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
}

func GetDiceWelfarePoolQuota() (int64, error) {
	var poolRow DiceWelfarePool
	if err := DB.FirstOrCreate(&poolRow, DiceWelfarePool{Id: 1}).Error; err != nil {
		return 0, err
	}
	return poolRow.Quota, nil
}

func getDiceWelfareStatus(userId, balance int) (pool int64, claimed bool, eligible bool, err error) {
	var poolRow DiceWelfarePool
	if err = DB.FirstOrCreate(&poolRow, DiceWelfarePool{Id: 1}).Error; err != nil {
		return
	}
	pool = poolRow.Quota
	var count int64
	if err = DB.Model(&DiceWelfareClaim{}).Where("user_id = ? AND claim_date = ?", userId, diceWelfareDate()).Count(&count).Error; err != nil {
		return
	}
	claimed = count > 0
	setting := operation_setting.GetDiceGameSetting()
	eligible = balance < setting.WelfareBalanceThreshold && !claimed && pool > 0
	return
}

func GetDiceGameStatus(userId int) (map[string]interface{}, error) {
	setting := operation_setting.GetDiceGameSetting()
	playsToday, err := countDiceGamePlaysToday(userId)
	if err != nil {
		return nil, err
	}
	playsLeft := setting.DailyMaxPlays - playsToday
	if playsLeft < 0 {
		playsLeft = 0
	}
	balance, err := GetUserQuota(userId, true)
	if err != nil {
		return nil, err
	}
	pool, claimed, eligible, err := getDiceWelfareStatus(userId, balance)
	if err != nil {
		return nil, err
	}
	var records []DiceGameRecord
	DB.Where("user_id = ?", userId).Order("created_at DESC").Limit(20).Find(&records)
	return map[string]interface{}{
		"enabled": setting.Enabled, "min_bet": setting.MinBet, "max_bet": setting.MaxBet,
		"payout_rate": setting.PayoutRate, "daily_max_plays": setting.DailyMaxPlays,
		"plays_today": playsToday, "plays_left": playsLeft, "balance": balance, "records": records,
		"welfare_pool": pool, "welfare_balance_threshold": setting.WelfareBalanceThreshold,
		"welfare_daily_grant": setting.WelfareDailyGrant, "welfare_claimed_today": claimed,
		"welfare_eligible": eligible,
	}, nil
}

func PlayDiceGame(userId int, choice string, bet int) (*DiceGameResult, error) {
	setting := operation_setting.GetDiceGameSetting()
	if !setting.Enabled {
		return nil, errors.New("小游戏功能未启用")
	}
	if choice != "big" && choice != "small" {
		return nil, errors.New("下注选项无效")
	}
	if bet < setting.MinBet || bet > setting.MaxBet {
		return nil, fmt.Errorf("下注额度需在 %d ~ %d 之间", setting.MinBet, setting.MaxBet)
	}
	playsToday, err := countDiceGamePlaysToday(userId)
	if err != nil {
		return nil, err
	}
	if setting.DailyMaxPlays > 0 && playsToday >= setting.DailyMaxPlays {
		return nil, errors.New("今日游戏次数已用完")
	}
	balance, err := GetUserQuota(userId, true)
	if err != nil {
		return nil, err
	}
	if balance < bet {
		return nil, errors.New("额度不足")
	}

	d1, d2, d3 := rand.Intn(6)+1, rand.Intn(6)+1, rand.Intn(6)+1
	sum := d1 + d2 + d3
	isTriple := d1 == d2 && d2 == d3
	win := !isTriple && ((choice == "big" && sum >= 11) || (choice == "small" && sum <= 10))
	payout := 0
	if win {
		payout = int(float64(bet) * setting.PayoutRate)
	}
	netChange := payout - bet
	record := &DiceGameRecord{UserId: userId, Choice: choice, Bet: bet, Dice1: d1, Dice2: d2, Dice3: d3, Sum: sum, IsTriple: isTriple, Win: win, Payout: payout, NetChange: netChange, CreatedAt: time.Now().Unix()}
	newBalance, err := settleDiceGame(record, userId, netChange)
	if err != nil {
		return nil, err
	}
	if err := updateUserQuotaCache(userId, newBalance); err != nil {
		common.SysLog("failed to update user quota cache after dice game: " + err.Error())
	}
	playsLeft := setting.DailyMaxPlays - playsToday - 1
	if playsLeft < 0 {
		playsLeft = 0
	}
	return &DiceGameResult{Dice: [3]int{d1, d2, d3}, Sum: sum, IsTriple: isTriple, Win: win, Bet: bet, Payout: payout, NetChange: netChange, Balance: newBalance, PlaysToday: playsToday + 1, PlaysLeft: playsLeft}, nil
}

// settleDiceGame 原子完成记录、用户结算和输掉下注入池。
func settleDiceGame(record *DiceGameRecord, userId, netChange int) (int, error) {
	var newBalance int
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(record).Error; err != nil {
			return errors.New("游戏记录写入失败")
		}
		if netChange < 0 {
			res := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, -netChange).Update("quota", gorm.Expr("quota + ?", netChange))
			if res.Error != nil || res.RowsAffected == 0 {
				return errors.New("额度不足")
			}
		} else if netChange > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", netChange)).Error; err != nil {
				return errors.New("额度结算失败")
			}
		}
		if !record.Win {
			if err := tx.FirstOrCreate(&DiceWelfarePool{}, DiceWelfarePool{Id: 1}).Error; err != nil {
				return errors.New("低保池初始化失败")
			}
			if err := tx.Model(&DiceWelfarePool{}).Where("id = ?", 1).Updates(map[string]interface{}{"quota": gorm.Expr("quota + ?", record.Bet), "updated_at": time.Now().Unix()}).Error; err != nil {
				return errors.New("低保池入账失败")
			}
		}
		return tx.Model(&User{}).Where("id = ?", userId).Select("quota").Scan(&newBalance).Error
	})
	return newBalance, err
}

func ClaimDiceWelfare(userId int) (*DiceWelfareResult, error) {
	setting := operation_setting.GetDiceGameSetting()
	if setting.WelfareBalanceThreshold <= 0 || setting.WelfareDailyGrant <= 0 {
		return nil, errors.New("低保功能未配置")
	}
	var result DiceWelfareResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var user User
		if err := query.Select("id", "quota").First(&user, userId).Error; err != nil {
			return errors.New("用户不存在")
		}
		if user.Quota >= setting.WelfareBalanceThreshold {
			return errors.New("当前余额未低于低保领取线")
		}
		date := diceWelfareDate()
		var count int64
		if err := tx.Model(&DiceWelfareClaim{}).Where("user_id = ? AND claim_date = ?", userId, date).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errors.New("今日已经领取过低保")
		}
		if err := tx.FirstOrCreate(&DiceWelfarePool{}, DiceWelfarePool{Id: 1}).Error; err != nil {
			return err
		}
		var pool DiceWelfarePool
		poolQuery := tx
		if !common.UsingSQLite {
			poolQuery = poolQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := poolQuery.First(&pool, 1).Error; err != nil {
			return err
		}
		if pool.Quota <= 0 {
			return errors.New("低保池暂无额度")
		}
		grant := int64(setting.WelfareDailyGrant)
		if pool.Quota < grant {
			grant = pool.Quota
		}
		claim := DiceWelfareClaim{UserId: userId, ClaimDate: date, Quota: int(grant), CreatedAt: time.Now().Unix()}
		if err := tx.Create(&claim).Error; err != nil {
			return errors.New("今日已经领取过低保")
		}
		userUpdate := tx.Model(&User{}).Where("id = ? AND quota < ?", userId, setting.WelfareBalanceThreshold).Update("quota", gorm.Expr("quota + ?", grant))
		if userUpdate.Error != nil || userUpdate.RowsAffected == 0 {
			return errors.New("当前余额未低于低保领取线")
		}
		poolUpdate := tx.Model(&DiceWelfarePool{}).Where("id = ? AND quota >= ?", 1, grant).Updates(map[string]interface{}{"quota": gorm.Expr("quota - ?", grant), "updated_at": time.Now().Unix()})
		if poolUpdate.Error != nil || poolUpdate.RowsAffected == 0 {
			return errors.New("低保池额度不足")
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Select("quota").Scan(&result.Balance).Error; err != nil {
			return err
		}
		result.Granted = int(grant)
		result.PoolRemaining = pool.Quota - grant
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := updateUserQuotaCache(userId, result.Balance); err != nil {
		common.SysLog("failed to update user quota cache after welfare claim: " + err.Error())
	}
	return &result, nil
}
