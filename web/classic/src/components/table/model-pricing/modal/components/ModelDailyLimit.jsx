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
import { Avatar, Typography, Table, Tag } from '@douyinfe/semi-ui';
import { IconPulse } from '@douyinfe/semi-icons';

const { Text } = Typography;

const ModelDailyLimit = ({ modelData, t }) => {
  if (!modelData || !modelData.daily_limits) return null;

  const entries = Object.entries(modelData.daily_limits);
  if (entries.length === 0) return null;

  const dataSource = entries
    .map(([group, usage]) => {
      const limit = usage?.limit ?? 0;
      const used = usage?.used ?? 0;
      return {
        key: group,
        group,
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        resetHour: usage?.reset_hour ?? 0,
        reached: used >= limit,
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));

  const columns = [
    {
      title: t('分组'),
      dataIndex: 'group',
      render: (text) => <span className='font-mono'>{text}</span>,
    },
    {
      title: t('今日已用'),
      dataIndex: 'used',
      align: 'right',
      render: (v) => <span className='font-mono'>{v.toLocaleString()}</span>,
    },
    {
      title: t('每日上限'),
      dataIndex: 'limit',
      align: 'right',
      render: (v) => <span className='font-mono'>{v.toLocaleString()}</span>,
    },
    {
      title: t('刷新时间'),
      dataIndex: 'resetHour',
      align: 'right',
      render: (v) =>
        t('北京时间 {{hour}}:00', {
          hour: String(v).padStart(2, '0'),
        }),
    },
    {
      title: t('剩余'),
      dataIndex: 'remaining',
      align: 'right',
      render: (v, record) => (
        <Tag color={record.reached ? 'red' : 'green'} shape='circle'>
          {v.toLocaleString()}
        </Tag>
      ),
    },
  ];

  return (
    <div>
      <div className='flex items-center mb-4'>
        <Avatar size='small' color='orange' className='mr-2 shadow-md'>
          <IconPulse size={16} />
        </Avatar>
        <div>
          <Text className='text-lg font-medium'>{t('每日调用限额')}</Text>
          <div className='text-xs text-gray-600'>
            {t('同分组用户共享额度，按表中北京时间刷新，仅统计成功调用')}
          </div>
        </div>
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size='small'
      />
    </div>
  );
};

export default ModelDailyLimit;
