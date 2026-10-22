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
import {
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';

const Risk = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [unlimiting, setUnlimiting] = useState(false);

  const load = async (kw = '') => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/risk/limited_users?keyword=${encodeURIComponent(kw.trim())}`,
      );
      const { success, message, data } = res.data;
      if (!success) return showError(message);
      setItems(data.items || []);
      setSelectedRowKeys([]);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  const handleUnlimit = (userIds) => {
    if (!userIds || userIds.length === 0) return;
    Modal.confirm({
      title: t('确认解除限速'),
      content: t('确定解除选中 {{count}} 个用户的限速吗？', {
        count: userIds.length,
      }),
      okText: t('确认解除限速'),
      cancelText: t('取消'),
      centered: true,
      onOk: async () => {
        setUnlimiting(true);
        try {
          const res = await API.post('/api/risk/unlimit', {
            user_ids: userIds,
          });
          const { success, message, data } = res.data;
          if (!success) return showError(message);
          showSuccess(
            t('已解除 {{count}} 个用户的限速', {
              count: data?.unlimited_count ?? 0,
            }),
          );
          load(keyword);
        } catch (error) {
          showError(error.message);
        } finally {
          setUnlimiting(false);
        }
      },
    });
  };

  const columns = [
    {
      title: t('用户'),
      dataIndex: 'username',
      render: (_, record) => (
        <div>
          <Typography.Text strong>
            {record.display_name || record.username}
          </Typography.Text>
          <Typography.Text
            type='tertiary'
            size='small'
            style={{ display: 'block' }}
          >
            {record.username} · UID {record.user_id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('触发分组'),
      dataIndex: 'group',
      render: (value, record) => (
        <Space spacing={4} wrap>
          {value ? (
            <Tag color='orange'>{value}</Tag>
          ) : (
            <Typography.Text type='tertiary'>-</Typography.Text>
          )}
          {record.model ? <Tag>{record.model}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t('触发次数'),
      dataIndex: 'trigger_count',
      width: 100,
    },
    {
      title: t('最近工具调用'),
      dataIndex: 'recent_calls',
      render: (calls) =>
        calls && calls.length > 0 ? (
          <Space spacing={4} wrap>
            {calls.map((call, index) => (
              <Tag key={`${call}-${index}`}>{call}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type='tertiary'>-</Typography.Text>
        ),
    },
    {
      title: t('限速力度'),
      dataIndex: 'rate_limit_rpm',
      width: 160,
      render: (value) => `${value || 1} RPM / ${t('并发上限')} 1`,
    },
    {
      title: t('到期时间'),
      dataIndex: 'rate_limit_until',
      width: 180,
      render: (value) => timestamp2string(value),
    },
    {
      title: t('操作'),
      width: 120,
      render: (_, record) => (
        <Button
          size='small'
          theme='light'
          onClick={() => handleUnlimit([record.user_id])}
        >
          {t('解除限速')}
        </Button>
      ),
    },
  ];

  return (
    <div className='mt-[60px] max-w-7xl mx-auto px-4 py-8'>
      <div className='mb-4'>
        <Typography.Title heading={3}>{t('代码执行风控')}</Typography.Title>
        <Typography.Text type='tertiary' size='small'>
          {t(
            '仅在非豁免分组中累计真实代码执行（tool_call_id 闭环），达到阈值后对该用户全局限速 24 小时：每分钟 1 次、并发 1。解除后立即恢复原有限制。',
          )}
        </Typography.Text>
      </div>

      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <Space>
          <Input
            value={keyword}
            onChange={setKeyword}
            placeholder={t('搜索 UID 或用户名')}
            style={{ width: 240 }}
            onEnterPress={() => load(keyword)}
          />
          <Button loading={loading} onClick={() => load(keyword)}>
            {t('刷新')}
          </Button>
        </Space>
        <Space>
          <Typography.Text type='tertiary'>
            {t('当前限速用户')}：{items.length}
          </Typography.Text>
          <Button
            type='danger'
            theme='light'
            disabled={selectedRowKeys.length === 0}
            loading={unlimiting}
            onClick={() => handleUnlimit(selectedRowKeys)}
          >
            {t('批量解除')}
          </Button>
        </Space>
      </div>

      <Card className='!rounded-xl'>
        <Table
          rowKey='user_id'
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          empty={t('暂无被限速的用户')}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
        />
      </Card>
    </div>
  );
};

export default Risk;
