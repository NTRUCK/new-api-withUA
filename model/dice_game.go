package model

import (
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// DiceGameRecord 骰子猜大小游戏记录
type DiceGameRecord struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"user_id" gorm:"index;not null"`
	Choice     string `json:"choice" gorm:"type:varchar(8);not null"` // big / small
	Bet        int    `json:"bet" gorm:"not null"`
	EntryFee   int    `json:"entry_fee" gorm:"not null"`
	Dice1      int    `json:"dice1" gorm:"not null"`
	Dice2      int    `json:"dice2" gorm:"not null"`
	Dice3      int    `json:"dice3" gorm:"not null"`
	Sum        int    `json:"sum" gorm:"not null"`
	IsTriple   bool   `json:"is_triple" gorm:"not null"`
	Win        bool   `json:"win" gorm:"not null"`
	Payout     int    `json:"payout" gorm:"not null"`     // 猜中返还额度（含本金）
	NetChange  int    `json:"net_change" gorm:"not null"` // 本局额度净变化（payout - bet - entry_fee）
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
}

func (DiceGameRecord) TableName() string {
	return "dice_game_records"
}

// DiceGameResult 单局游戏结果（返回给前端）
type DiceGameResult struct {
	Dice       [3]int `json:"dice"`
	Sum        int    `json:"sum"`
	IsTriple   bool   `json:"is_triple"`
	Win        bool   `json:"win"`
	Bet        int    `json:"bet"`
	Payout     int    `json:"payout"`
	NetChange  int    `json:"net_change"`
	Balance    int    `json:"balance"`     // 结算后剩余额度
	PlaysToday int    `json:"plays_today"` // 今日已玩局数（含本局）
	PlaysLeft  int    `json:"plays_left"`  // 今日剩余可玩局数
}

// countDiceGamePlaysToday 今日已玩局数
func countDiceGamePlaysToday(userId int) (int, error) {
	// 本地时区当天 00:00
	y, m, d := time.Now().Date()
	loc := time.Now().Location()
	startOfDay := time.Date(y, m, d, 0, 0, 0, 0, loc)
	var count int64
	err := DB.Model(&DiceGameRecord{}).
		Where("user_id = ? AND created_at >= ?", userId, startOfDay.Unix()).
		Count(&count).Error
	return int(count), err
}

// GetDiceGameStatus 获取用户游戏状态
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
	balance, _ := GetUserQuota(userId, false)

	var records []DiceGameRecord
	DB.Where("user_id = ?", userId).Order("created_at DESC").Limit(20).Find(&records)

	return map[string]interface{}{
		"enabled":         setting.Enabled,
		"min_bet":         setting.MinBet,
		"max_bet":         setting.MaxBet,
		"payout_rate":     setting.PayoutRate,
		"daily_max_plays": setting.DailyMaxPlays,
		"plays_today":     playsToday,
		"plays_left":      playsLeft,
		"balance":         balance,
		"records":         records,
	}, nil
}

// PlayDiceGame 执行一局骰子猜大小
// choice: "big"(11-18) 或 "small"(3-10)；出现豹子（三颗相同）庄家通吃
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

	// 下注本身即为成本，不额外收取入场费
	balance, err := GetUserQuota(userId, false)
	if err != nil {
		return nil, err
	}
	cost := bet
	if balance < cost {
		return nil, errors.New("额度不足")
	}

	// 掷骰子
	d1 := rand.Intn(6) + 1
	d2 := rand.Intn(6) + 1
	d3 := rand.Intn(6) + 1
	sum := d1 + d2 + d3
	isTriple := d1 == d2 && d2 == d3

	// 判定输赢：豹子庄家通吃
	win := false
	if !isTriple {
		if choice == "big" && sum >= 11 {
			win = true
		} else if choice == "small" && sum <= 10 {
			win = true
		}
	}

	payout := 0
	if win {
		payout = int(float64(bet) * setting.PayoutRate)
	}
	netChange := payout - cost

	record := &DiceGameRecord{
		UserId:    userId,
		Choice:    choice,
		Bet:       bet,
		EntryFee:  0,
		Dice1:     d1,
		Dice2:     d2,
		Dice3:     d3,
		Sum:       sum,
		IsTriple:  isTriple,
		Win:       win,
		Payout:    payout,
		NetChange: netChange,
		CreatedAt: time.Now().Unix(),
	}

	if err := settleDiceGame(record, userId, netChange); err != nil {
		return nil, err
	}

	newBalance := balance + netChange
	playsLeft := setting.DailyMaxPlays - (playsToday + 1)
	if playsLeft < 0 {
		playsLeft = 0
	}

	return &DiceGameResult{
		Dice:       [3]int{d1, d2, d3},
		Sum:        sum,
		IsTriple:   isTriple,
		Win:        win,
		Bet:        bet,
		Payout:     payout,
		NetChange:  netChange,
		Balance:    newBalance,
		PlaysToday: playsToday + 1,
		PlaysLeft:  playsLeft,
	}, nil
}

// settleDiceGame 原子结算：写入记录并按净变化调整额度
func settleDiceGame(record *DiceGameRecord, userId int, netChange int) error {
	if common.UsingSQLite {
		if err := DB.Create(record).Error; err != nil {
			return errors.New("游戏记录写入失败")
		}
		if err := applyDiceGameQuota(userId, netChange); err != nil {
			DB.Delete(record)
			return errors.New("额度结算失败")
		}
		return nil
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(record).Error; err != nil {
			return errors.New("游戏记录写入失败")
		}
		// netChange < 0 时需保证不会扣成负数
		if netChange < 0 {
			res := tx.Model(&User{}).
				Where("id = ? AND quota >= ?", userId, -netChange).
				Update("quota", gorm.Expr("quota + ?", netChange))
			if res.Error != nil {
				return errors.New("额度结算失败")
			}
			if res.RowsAffected == 0 {
				return errors.New("额度不足")
			}
		} else if netChange > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota + ?", netChange)).Error; err != nil {
				return errors.New("额度结算失败")
			}
		}
		return nil
	})
}

// applyDiceGameQuota SQLite 下顺序调整额度（无事务）
func applyDiceGameQuota(userId int, netChange int) error {
	if netChange == 0 {
		return nil
	}
	if netChange > 0 {
		return IncreaseUserQuota(userId, netChange, true)
	}
	return DecreaseUserQuota(userId, -netChange, true)
}
