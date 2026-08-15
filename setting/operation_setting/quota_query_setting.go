package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

type QuotaQuerySetting struct {
	Enabled           bool `json:"enabled"`
	ShowEntry         bool `json:"show_entry"`
	Fee               int  `json:"fee"`
	DailyLimit        int  `json:"daily_limit"`
	AllowAdminAndRoot bool `json:"allow_admin_and_root"`
}

var quotaQuerySetting = QuotaQuerySetting{
	Enabled:           false,
	ShowEntry:         false,
	Fee:               500000,
	DailyLimit:        3,
	AllowAdminAndRoot: false,
}

func init() {
	config.GlobalConfig.Register("quota_query_setting", &quotaQuerySetting)
}

func GetQuotaQuerySetting() *QuotaQuerySetting {
	return &quotaQuerySetting
}
