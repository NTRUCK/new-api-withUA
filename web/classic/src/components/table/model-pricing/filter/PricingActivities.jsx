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

import React from 'react';
import SelectableButtonGroup from '../../../common/ui/SelectableButtonGroup';

// 模型近期是否有调用，依据后端返回的性能摘要（近 1 小时成功率）判断。
export const hasRecentActivity = (model) =>
  !!model?.perf && Number.isFinite(model.perf.success_rate);

/**
 * 调用状态筛选组件
 * @param {string|'all'|'active'|'inactive'} filterActivity 当前值
 * @param {Function} setFilterActivity setter
 * @param {Array} models 模型列表
 * @param {boolean} loading 是否加载中
 * @param {Function} t i18n
 */
const PricingActivities = ({
  filterActivity,
  setFilterActivity,
  models = [],
  loading = false,
  t,
}) => {
  const activeCount = models.filter(hasRecentActivity).length;

  const items = [
    { value: 'all', label: t('全部状态'), tagCount: models.length },
    { value: 'active', label: t('近期有调用'), tagCount: activeCount },
    {
      value: 'inactive',
      label: t('近期无调用'),
      tagCount: models.length - activeCount,
    },
  ];

  return (
    <SelectableButtonGroup
      title={t('调用状态')}
      items={items}
      activeValue={filterActivity}
      onChange={setFilterActivity}
      loading={loading}
      variant='green'
      t={t}
    />
  );
};

export default PricingActivities;
