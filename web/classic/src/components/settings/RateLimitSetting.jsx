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

import React, { useEffect, useState } from 'react';
import { Card, Spin } from '@douyinfe/semi-ui';

import { API, showError, toBoolean } from '../../helpers';
import { useTranslation } from 'react-i18next';
import RequestRateLimit from '../../pages/Setting/RateLimit/SettingsRequestRateLimit';
import ModelDailyLimit from '../../pages/Setting/RateLimit/SettingsModelDailyLimit';
import UserDailyTier from '../../pages/Setting/RateLimit/SettingsUserDailyTier';

const RateLimitSetting = () => {
  const { t } = useTranslation();
  let [inputs, setInputs] = useState({
    ModelRequestRateLimitEnabled: false,
    ModelRequestRateLimitCount: 0,
    ModelRequestRateLimitSuccessCount: 1000,
    ModelRequestRateLimitDurationMinutes: 1,
    ModelRequestRateLimitGroup: '',
    ModelDailyLimitEnabled: false,
    ModelDailyLimit: '',
    ModelDailyLimitGroups: '',
    UserDailyTierEnabled: false,
    UserDailyTierAdminExempt: true,
    UserDailyTierResetHour: 0,
    UserDailyTierHardLimit: 0,
    UserDailyTier: '',
  });

  let [loading, setLoading] = useState(false);

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        if (
          item.key === 'ModelRequestRateLimitGroup' ||
          item.key === 'ModelDailyLimit' ||
          item.key === 'ModelDailyLimitGroups'
        ) {
          try {
            item.value = JSON.stringify(JSON.parse(item.value), null, 2);
          } catch {
            // 保留原值
          }
        }

        if (item.key.endsWith('Enabled')) {
          newInputs[item.key] = toBoolean(item.value);
        } else {
          newInputs[item.key] = item.value;
        }
      });

      setInputs(newInputs);
    } else {
      showError(message);
    }
  };
  async function onRefresh() {
    try {
      setLoading(true);
      await getOptions();
      // showSuccess('刷新成功');
    } catch (error) {
      showError('刷新失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    onRefresh();
  }, []);

  return (
    <>
      <Spin spinning={loading} size='large'>
        {/* AI请求速率限制 */}
        <Card style={{ marginTop: '10px' }}>
          <RequestRateLimit options={inputs} refresh={onRefresh} />
        </Card>
        <Card style={{ marginTop: '10px' }}>
          <ModelDailyLimit options={inputs} refresh={onRefresh} />
        </Card>
        <Card style={{ marginTop: '10px' }}>
          <UserDailyTier options={inputs} refresh={onRefresh} />
        </Card>
      </Spin>
    </>
  );
};

export default RateLimitSetting;
