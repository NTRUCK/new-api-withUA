package setting

import "github.com/QuantumNous/new-api/setting/config"

type RankingSetting struct {
	ExcludeAdminAndRoot bool `json:"exclude_admin_and_root"`
}

var rankingSetting = RankingSetting{
	ExcludeAdminAndRoot: false,
}

func init() {
	config.GlobalConfig.Register("ranking_setting", &rankingSetting)
}

func ExcludeAdminAndRootFromRankings() bool {
	return rankingSetting.ExcludeAdminAndRoot
}
