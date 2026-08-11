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
import { Tooltip } from '@douyinfe/semi-ui';
import { Coins, Crown, Flame, HandCoins } from 'lucide-react';
import { API, renderQuota } from '../../../helpers';

// 全站榜单与活跃人数，仅登录用户可见，显示在通知按钮左侧
const ActiveUsersBadge = ({ userState, t }) => {
  const [stats, setStats] = useState(null);
  const isLoggedIn = !!(userState && userState.user);

  useEffect(() => {
    if (!isLoggedIn) return;
    let timer = null;
    const load = async () => {
      try {
        const res = await API.get('/api/user/active_users');
        if (res.data?.success) {
          setStats({
            activeUsers: res.data.data?.active_users_1h ?? 0,
            topUser: res.data.data?.yesterday_top_user || '',
            topCalls: res.data.data?.yesterday_top_calls ?? 0,
            welfarePool: res.data.data?.welfare_pool ?? 0,
            richestUser: res.data.data?.richest_user || '',
            richestQuota: res.data.data?.richest_user_quota ?? 0,
          });
        }
      } catch (e) {
        // 静默失败，不影响头部
      }
    };
    load();
    timer = setInterval(load, 60000); // 每分钟刷新
    return () => timer && clearInterval(timer);
  }, [isLoggedIn]);

  if (!isLoggedIn || stats === null) return null;

  return (
    <div className='flex items-center gap-2'>
      <Tooltip content={t('当前骰子低保池额度')}>
        <div className='flex items-center gap-1 px-2 py-1 rounded-full bg-semi-color-fill-0 dark:bg-semi-color-fill-1 text-sm font-medium select-none'>
          <HandCoins size={15} className='text-emerald-500' />
          <span>{renderQuota(stats.welfarePool)}</span>
        </div>
      </Tooltip>
      {stats.richestUser && (
        <Tooltip content={t('当前额度最多的用户')}>
          <div className='flex items-center gap-1 px-2 py-1 rounded-full bg-semi-color-fill-0 dark:bg-semi-color-fill-1 text-sm font-medium select-none'>
            <Coins size={15} className='text-amber-500' />
            <span className='max-w-24 truncate'>{stats.richestUser}</span>
            <span>{renderQuota(stats.richestQuota)}</span>
          </div>
        </Tooltip>
      )}
      {stats.topUser && (
        <Tooltip content={t('北京时间前一天调用次数最多的用户')}>
          <div className='flex items-center gap-1 px-2 py-1 rounded-full bg-semi-color-fill-0 dark:bg-semi-color-fill-1 text-sm font-medium select-none'>
            <Crown size={15} className='text-yellow-500' />
            <span className='max-w-24 truncate'>{stats.topUser}</span>
            <span>{stats.topCalls.toLocaleString()}</span>
          </div>
        </Tooltip>
      )}
      <Tooltip content={t('全站活跃人数（近 1 小时调用 ≥ 10 次）')}>
        <div className='flex items-center gap-1 px-2 py-1 rounded-full bg-semi-color-fill-0 dark:bg-semi-color-fill-1 text-sm font-medium select-none'>
          <Flame size={15} className='text-orange-500' />
          <span>{stats.activeUsers}</span>
        </div>
      </Tooltip>
    </div>
  );
};

export default ActiveUsersBadge;
