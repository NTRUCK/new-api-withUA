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

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Input,
  Space,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconUser } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { API, showError, timestamp2string } from '../../helpers';

// 后端 UserReview 状态：0=待审核 1=已通过
const STATUS_META = {
  0: { label: '审核中', color: 'blue' },
  1: { label: '已通过', color: 'green' },
};

/**
 * 申请人自助查询审核进度。
 * 申请人此时还没有账号，因此该视图不依赖登录态。
 */
const StatusQuery = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState(searchParams.get('username') || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback(
    async (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) {
        showError(t('请输入注册时使用的用户名'));
        return;
      }
      setLoading(true);
      try {
        const res = await API.get(
          `/api/user_review/status?username=${encodeURIComponent(trimmed)}`,
        );
        const { success, message, data } = res.data;
        if (!success) {
          setResult(null);
          showError(message);
          return;
        }
        setResult(data);
      } catch (error) {
        setResult(null);
        showError(error.message);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // 注册提交成功后跳转过来会带上 ?username=，此时自动查询一次
  useEffect(() => {
    const initial = searchParams.get('username');
    if (initial) {
      query(initial);
    }
    // 仅在首次挂载时按 URL 参数查询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = result ? STATUS_META[result.status] : null;

  return (
    <Card className='!rounded-2xl shadow-sm border-0'>
      <Typography.Title heading={4}>{t('注册审核进度')}</Typography.Title>
      <Typography.Text type='tertiary'>
        {t('输入注册时使用的用户名，即可查询审核进度')}
      </Typography.Text>

      <Space className='mt-4 w-full'>
        <Input
          value={username}
          onChange={setUsername}
          placeholder={t('请输入用户名')}
          prefix={<IconUser />}
          onEnterPress={() => query(username)}
          style={{ width: 260 }}
        />
        <Button
          theme='solid'
          type='primary'
          loading={loading}
          onClick={() => query(username)}
        >
          {t('查询')}
        </Button>
      </Space>

      {result && (
        <div className='mt-6 p-4 rounded-xl bg-semi-color-fill-0'>
          <div className='flex items-center gap-3 mb-3'>
            <Typography.Text strong>{result.username}</Typography.Text>
            {meta && (
              <Tag color={meta.color} shape='circle'>
                {t(meta.label)}
              </Tag>
            )}
          </div>
          <div className='text-sm text-semi-color-text-2 space-y-1'>
            <div>
              {t('提交时间')}：{timestamp2string(result.created_at)}
            </div>
            {result.reviewed_at > 0 && (
              <div>
                {t('审核时间')}：{timestamp2string(result.reviewed_at)}
              </div>
            )}
          </div>
          <div className='mt-3 text-sm'>
            {result.status === 0 && (
              <Typography.Text type='tertiary'>
                {t('申请已提交，请耐心等待管理员审核。审核通过后即可登录。')}
              </Typography.Text>
            )}
            {result.status === 1 && (
              <Typography.Text type='success'>
                {t('审核已通过，请前往登录页登录。')}
              </Typography.Text>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};

export default StatusQuery;
