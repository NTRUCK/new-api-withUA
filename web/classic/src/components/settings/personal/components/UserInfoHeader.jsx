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

import React, { useState, useEffect, useContext } from 'react';
import {
  Avatar,
  Card,
  Tag,
  Divider,
  Typography,
  Badge,
  Select,
} from '@douyinfe/semi-ui';
import {
  isRoot,
  isAdmin,
  renderQuota,
  stringToColor,
  API,
  showSuccess,
  showError,
} from '../../../../helpers';
import { Coins, BarChart2, Users } from 'lucide-react';
import { UserContext } from '../../../../context/User';
import { useTranslation } from 'react-i18next';

// 读取管理员预设的展示货币列表（来自 /api/status 缓存）
const getCustomCurrencies = () => {
  try {
    const statusStr = localStorage.getItem('status');
    if (!statusStr) return [];
    const s = JSON.parse(statusStr);
    const list = s?.custom_currencies;
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && c.key && c.symbol);
  } catch (e) {
    return [];
  }
};

const UserInfoHeader = ({ t, userState }) => {
  const { i18n } = useTranslation();
  const [, userDispatch] = useContext(UserContext);
  const [currentCurrency, setCurrentCurrency] = useState('');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [customCurrencies, setCustomCurrencies] = useState(
    getCustomCurrencies,
  );

  useEffect(() => {
    setCustomCurrencies(getCustomCurrencies());
  }, [i18n.language]);

  // 从用户设置中加载已保存的展示货币偏好
  useEffect(() => {
    if (userState?.user?.setting) {
      try {
        const settings = JSON.parse(userState.user.setting);
        setCurrentCurrency(settings.display_currency || '');
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [userState?.user?.setting]);

  const handleCurrencyChange = async (key) => {
    if (key === currentCurrency || savingCurrency) return;
    setSavingCurrency(true);
    const previousCurrency = currentCurrency;
    setCurrentCurrency(key);
    try {
      // 仅能选择管理员预设的货币（空串 = 跟随站点默认）
      const res = await API.put('/api/user/self', {
        display_currency: key,
      });
      if (res.data.success) {
        // 同步 user setting 到上下文与本地缓存
        let settings = {};
        if (userState?.user?.setting) {
          try {
            settings = JSON.parse(userState.user.setting) || {};
          } catch (e) {
            settings = {};
          }
        }
        settings.display_currency = key;
        const nextUser = {
          ...userState.user,
          setting: JSON.stringify(settings),
        };
        userDispatch({ type: 'login', payload: nextUser });
        localStorage.setItem('user', JSON.stringify(nextUser));
        // 渲染函数直读此键，立即生效
        if (key) {
          localStorage.setItem('display_currency', key);
        } else {
          localStorage.removeItem('display_currency');
        }
        showSuccess(t('展示货币已保存'));
      } else {
        showError(res.data.message || t('保存失败'));
        setCurrentCurrency(previousCurrency);
      }
    } catch (error) {
      showError(t('保存失败，请重试'));
      setCurrentCurrency(previousCurrency);
    } finally {
      setSavingCurrency(false);
    }
  };

  const currencyOptions = [
    { value: '', label: t('跟随站点默认') },
    ...customCurrencies.map((c) => ({
      value: c.key,
      label: `${c.name || c.key} (${c.symbol})`,
    })),
  ];
  const getUsername = () => {
    if (userState.user) {
      return userState.user.username;
    } else {
      return 'null';
    }
  };

  const getAvatarText = () => {
    const username = getUsername();
    if (username && username.length > 0) {
      return username.slice(0, 2).toUpperCase();
    }
    return 'NA';
  };

  return (
    <Card
      className='!rounded-2xl overflow-hidden'
      cover={
        <div
          className='relative h-32'
          style={{
            '--palette-primary-darkerChannel': '0 75 80',
            backgroundImage: `linear-gradient(0deg, rgba(var(--palette-primary-darkerChannel) / 80%), rgba(var(--palette-primary-darkerChannel) / 80%)), url('/cover-4.webp')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {/* 用户信息内容 */}
          <div className='relative z-10 h-full flex flex-col justify-end p-6'>
            <div className='flex items-center'>
              <div className='flex items-stretch gap-3 sm:gap-4 flex-1 min-w-0'>
                <Avatar size='large' color={stringToColor(getUsername())}>
                  {getAvatarText()}
                </Avatar>
                <div className='flex-1 min-w-0 flex flex-col justify-between'>
                  <div
                    className='text-3xl font-bold truncate'
                    style={{ color: 'white' }}
                  >
                    {getUsername()}
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    {isRoot() ? (
                      <Tag
                        size='large'
                        shape='circle'
                        style={{ color: 'white' }}
                      >
                        {t('超级管理员')}
                      </Tag>
                    ) : isAdmin() ? (
                      <Tag
                        size='large'
                        shape='circle'
                        style={{ color: 'white' }}
                      >
                        {t('管理员')}
                      </Tag>
                    ) : (
                      <Tag
                        size='large'
                        shape='circle'
                        style={{ color: 'white' }}
                      >
                        {t('普通用户')}
                      </Tag>
                    )}
                    <Tag size='large' shape='circle' style={{ color: 'white' }}>
                      ID: {userState?.user?.id}
                    </Tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    >
      {/* 当前余额和桌面版统计信息 */}
      <div className='flex items-start justify-between gap-6'>
        <div>
          {/* 当前余额显示 */}
          <Badge count={t('当前余额')} position='rightTop' type='danger'>
            <div className='text-2xl sm:text-3xl md:text-4xl font-bold tracking-wide'>
              {renderQuota(userState?.user?.quota)}
            </div>
          </Badge>

          {/* 展示货币选择（管理员未配置预设货币时不显示） */}
          {customCurrencies.length > 0 && (
            <div className='flex items-center gap-2 mt-3'>
              <Typography.Text size='small' type='tertiary'>
                {t('展示货币')}
              </Typography.Text>
              <Select
                size='small'
                value={
                  currencyOptions.some((o) => o.value === currentCurrency)
                    ? currentCurrency
                    : currentCurrency
                      ? undefined
                      : ''
                }
                placeholder={t('已失效，请重新选择')}
                onChange={handleCurrencyChange}
                style={{ width: 180 }}
                loading={savingCurrency}
                optionList={currencyOptions}
              />
            </div>
          )}
        </div>

        {/* 桌面版统计信息（Semi UI 卡片） */}
        <div className='hidden lg:block flex-shrink-0'>
          <Card
            size='small'
            className='!rounded-xl'
            bodyStyle={{ padding: '12px 16px' }}
          >
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <Coins size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('历史消耗')}
                </Typography.Text>
                <Typography.Text size='small' type='tertiary' strong>
                  {renderQuota(userState?.user?.used_quota)}
                </Typography.Text>
              </div>
              <Divider layout='vertical' />
              <div className='flex items-center gap-2'>
                <BarChart2 size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('请求次数')}
                </Typography.Text>
                <Typography.Text size='small' type='tertiary' strong>
                  {userState.user?.request_count || 0}
                </Typography.Text>
              </div>
              <Divider layout='vertical' />
              <div className='flex items-center gap-2'>
                <Users size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('用户分组')}
                </Typography.Text>
                <Typography.Text size='small' type='tertiary' strong>
                  {userState?.user?.group || t('默认')}
                </Typography.Text>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 移动端和中等屏幕统计信息卡片 */}
      <div className='lg:hidden mt-2'>
        <Card
          size='small'
          className='!rounded-xl'
          bodyStyle={{ padding: '12px 16px' }}
        >
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Coins size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('历史消耗')}
                </Typography.Text>
              </div>
              <Typography.Text size='small' type='tertiary' strong>
                {renderQuota(userState?.user?.used_quota)}
              </Typography.Text>
            </div>
            <Divider margin='8px' />
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <BarChart2 size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('请求次数')}
                </Typography.Text>
              </div>
              <Typography.Text size='small' type='tertiary' strong>
                {userState.user?.request_count || 0}
              </Typography.Text>
            </div>
            <Divider margin='8px' />
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Users size={16} />
                <Typography.Text size='small' type='tertiary'>
                  {t('用户分组')}
                </Typography.Text>
              </div>
              <Typography.Text size='small' type='tertiary' strong>
                {userState?.user?.group || t('默认')}
              </Typography.Text>
            </div>
          </div>
        </Card>
      </div>
    </Card>
  );
};

export default UserInfoHeader;
