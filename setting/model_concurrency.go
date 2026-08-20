package setting

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func ModelConcurrencyLimit2JSONString() string {
	data, err := common.Marshal(model_setting.GetGlobalSettings().ModelConcurrencyMapping)
	if err != nil {
		common.SysLog("error marshalling model concurrency limit: " + err.Error())
	}
	return string(data)
}

func UpdateModelConcurrencyLimitByJSONString(jsonStr string) error {
	limits := make(map[string]int)
	if jsonStr != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &limits); err != nil {
			return err
		}
	}
	model_setting.GetGlobalSettings().ModelConcurrencyMapping = limits
	return nil
}

func CheckModelConcurrencyLimit(jsonStr string) error {
	if jsonStr == "" {
		return nil
	}
	limits := make(map[string]int)
	if err := common.UnmarshalJsonStr(jsonStr, &limits); err != nil {
		return err
	}
	for modelName, limit := range limits {
		if modelName == "" {
			return fmt.Errorf("model name cannot be empty")
		}
		if limit < 0 || limit > math.MaxInt32 {
			return fmt.Errorf("model %s has invalid concurrency limit: %d", modelName, limit)
		}
	}
	return nil
}

func GetModelConcurrencyLimit(modelName string) int {
	return model_setting.GetGlobalSettings().ModelConcurrencyMapping[modelName]
}
