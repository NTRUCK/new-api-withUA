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
import { Tag, Space, Skeleton, Button, Tooltip } from '@douyinfe/semi-ui';
import { API, renderQuota } from '../../../helpers';
import CompactModeToggle from '../../common/ui/CompactModeToggle';
import { BarChart3 } from 'lucide-react';
import { useMinimumLoadingTime } from '../../../hooks/common/useMinimumLoadingTime';

// 管理员内部参考：1h 调用人数 / 24h 调用人数 / 24h 高频(≥10次)人数
const ActivityStatsTags = ({ t }) => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let timer = null;
    const load = async () => {
      try {
        const res = await API.get('/api/log/activity_stats');
        if (res.data?.success) setStats(res.data.data);
      } catch (e) {
        // 静默失败
      }
    };
    load();
    timer = setInterval(load, 60000);
    return () => timer && clearInterval(timer);
  }, []);

  if (!stats) return null;

  const tagStyle = {
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    padding: 13,
  };

  return (
    <>
      <Tooltip content={t('近 1 小时有调用的人数')}>
        <Tag color='cyan' style={tagStyle} className='!rounded-lg'>
          {t('1h 用户')}: {stats.users_1h}
        </Tag>
      </Tooltip>
      <Tooltip content={t('近 24 小时有调用的人数')}>
        <Tag color='teal' style={tagStyle} className='!rounded-lg'>
          {t('24h 用户')}: {stats.users_24h}
        </Tag>
      </Tooltip>
      <Tooltip content={t('近 24 小时调用 ≥ 10 次的人数')}>
        <Tag color='indigo' style={tagStyle} className='!rounded-lg'>
          {t('24h 高频')}: {stats.active_users_24h}
        </Tag>
      </Tooltip>
    </>
  );
};

const LogsActions = ({
  stat,
  loadingStat,
  showStat,
  compactMode,
  setCompactMode,
  openUserStats,
  isAdminUser,
  t,
}) => {
  const showSkeleton = useMinimumLoadingTime(loadingStat);
  const needSkeleton = !showStat || showSkeleton;

  const placeholder = (
    <Space>
      <Skeleton.Title style={{ width: 108, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 65, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 64, height: 21, borderRadius: 6 }} />
    </Space>
  );

  return (
    <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full'>
      <Skeleton loading={needSkeleton} active placeholder={placeholder}>
        <Space>
          <Tag
            color='blue'
            style={{
              fontWeight: 500,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              padding: 13,
            }}
            className='!rounded-lg'
          >
            {t('消耗额度')}: {renderQuota(stat.quota)}
          </Tag>
          <Tag
            color='pink'
            style={{
              fontWeight: 500,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              padding: 13,
            }}
            className='!rounded-lg'
          >
            RPM: {stat.rpm}
          </Tag>
          <Tag
            color='white'
            style={{
              border: 'none',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              fontWeight: 500,
              padding: 13,
            }}
            className='!rounded-lg'
          >
            TPM: {stat.tpm}
          </Tag>
        </Space>
      </Skeleton>

      {isAdminUser && (
        <Space wrap>
          <ActivityStatsTags t={t} />
        </Space>
      )}

      <Space>
        {isAdminUser && (
          <Button
            type='tertiary'
            theme='outline'
            icon={<BarChart3 size={16} />}
            onClick={openUserStats}
            size='small'
          >
            {t('统计用户')}
          </Button>
        )}
        <CompactModeToggle
          compactMode={compactMode}
          setCompactMode={setCompactMode}
          t={t}
        />
      </Space>
    </div>
  );
};

export default LogsActions;
