package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// DiceGameSetting 骰子猜大小小游戏配置
// 玩法：3 颗骰子求和，猜「大(11-18)」或「小(3-10)」，猜中赔率 PayoutRate；
// 出现豹子（三颗点数相同）时庄家通吃，带来天然房差，期望值略小于 1。
type DiceGameSetting struct {
	Enabled                 bool    `json:"enabled"`                   // 是否启用（功能与 API）
	ShowEntry               bool    `json:"show_entry"`                // 是否在侧边栏显示入口菜单
	MinBet                  int     `json:"min_bet"`                   // 单局最小下注额度
	MaxBet                  int     `json:"max_bet"`                   // 单局最大下注额度
	PayoutRate              float64 `json:"payout_rate"`               // 猜中赔率（返还 = 下注 × 赔率）
	DailyMaxPlays           int     `json:"daily_max_plays"`           // 每日最大局数
	DailyResetHour          int     `json:"daily_reset_hour"`          // 每日重置小时（服务器本地时区，0-23）
	WelfareBalanceThreshold int     `json:"welfare_balance_threshold"` // 低保领取余额线
	WelfareDailyGrant       int     `json:"welfare_daily_grant"`       // 每日低保领取上限
	WelfareDailyRoundLimit  int     `json:"welfare_daily_round_limit"` // 每日自动生成红包期数上限
}

// 默认配置
var diceGameSetting = DiceGameSetting{
	Enabled:                 false,
	ShowEntry:               false,           // 默认不显示入口
	MinBet:                  500,             // 约 0.001 USD
	MaxBet:                  500000,          // 约 1 USD
	PayoutRate:              2.0,             // 猜中返还 2 倍（豹子通吃产生房差）
	DailyMaxPlays:           3,               // 每日最多 3 局
	DailyResetHour:          0,               // 默认服务器本地时间 00:00 重置
	WelfareBalanceThreshold: 10 * 500 * 1000, // 默认余额低于 10 可领取
	WelfareDailyGrant:       30 * 500 * 1000, // 默认每日最多领取 30
	WelfareDailyRoundLimit:  1,               // 默认每日自动生成 1 期红包
}

func init() {
	config.GlobalConfig.Register("dice_game_setting", &diceGameSetting)
}

// GetDiceGameSetting 获取骰子游戏配置
func GetDiceGameSetting() *DiceGameSetting {
	return &diceGameSetting
}

// IsDiceGameEnabled 是否启用骰子游戏
func IsDiceGameEnabled() bool {
	return diceGameSetting.Enabled
}
