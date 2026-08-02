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
  Empty,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  API,
  showError,
  showSuccess,
  timestamp2string,
} from '../../../helpers';

const PAGE_SIZE = 20;

// 反馈类型 -> 展示文案与颜色
const REASON_META = {
  fake: { color: 'red' },
  unavailable: { color: 'orange' },
  watered: { color: 'amber' },
  other: { color: 'grey' },
};

const ModelFeedbackTable = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(''); // '' 全部 / '0' 待处理 / '1' 已处理
  const [handlingId, setHandlingId] = useState(null);

  const reasonLabel = (code) => {
    switch (code) {
      case 'fake':
        return t('假模型');
      case 'unavailable':
        return t('不可用');
      case 'watered':
        return t('疑似掺水');
      default:
        return t('其他');
    }
  };

  const load = async (nextPage = 1, status = statusFilter) => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/model_feedback?p=${nextPage}&page_size=${PAGE_SIZE}${status !== '' ? `&status=${status}` : ''}`,
      );
      const { success, message, data } = res.data;
      if (!success) return showError(message);
      setItems(data.items || []);
      setPage(data.page || nextPage);
      setTotal(data.total || 0);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const handleMarkHandled = async (record) => {
    setHandlingId(record.id);
    try {
      const res = await API.post(`/api/model_feedback/${record.id}/handle`);
      const { success, message } = res.data;
      if (!success) return showError(message);
      showSuccess(t('已标记为处理'));
      load(page);
    } catch (error) {
      showError(error.message);
    } finally {
      setHandlingId(null);
    }
  };

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      render: (text) => (
        <Typography.Text copyable={{ content: text }}>{text}</Typography.Text>
      ),
    },
    {
      title: t('问题类型'),
      dataIndex: 'reason_code',
      render: (code) => (
        <Tag color={REASON_META[code]?.color || 'grey'} shape='circle'>
          {reasonLabel(code)}
        </Tag>
      ),
    },
    {
      title: t('补充说明'),
      dataIndex: 'reason_text',
      render: (text) =>
        text ? (
          <Typography.Paragraph
            className='!mb-0 whitespace-pre-wrap break-words'
            style={{ maxWidth: 320 }}
          >
            {text}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type='tertiary'>-</Typography.Text>
        ),
    },
    {
      title: t('反馈用户'),
      dataIndex: 'user_display_name',
      render: (name, record) => (
        <div className='flex flex-col'>
          <Typography.Text>{name || t('未知用户')}</Typography.Text>
          {record.user_discord_name && (
            <Typography.Text type='tertiary' size='small'>
              dc：{record.user_discord_name}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: t('提交时间'),
      dataIndex: 'created_at',
      render: (ts) => timestamp2string(ts),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: (status) =>
        status === 1 ? (
          <Tag color='green' shape='circle'>
            {t('已处理')}
          </Tag>
        ) : (
          <Tag color='blue' shape='circle'>
            {t('待处理')}
          </Tag>
        ),
    },
    {
      title: t('操作'),
      dataIndex: 'op',
      render: (_, record) =>
        record.status === 1 ? (
          <Typography.Text type='tertiary'>-</Typography.Text>
        ) : (
          <Button
            size='small'
            theme='light'
            type='primary'
            loading={handlingId === record.id}
            onClick={() => handleMarkHandled(record)}
          >
            {t('标记处理')}
          </Button>
        ),
    },
  ];

  return (
    <Card>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div>
          <Typography.Title heading={4} className='!mb-1'>
            {t('模型反馈')}
          </Typography.Title>
          <Typography.Text type='tertiary'>
            {t('用户在模型广场提交的模型问题反馈')}
          </Typography.Text>
        </div>
        <Select
          value={statusFilter}
          style={{ width: 160 }}
          onChange={(v) => {
            setStatusFilter(v);
            load(1, v);
          }}
          optionList={[
            { value: '', label: t('全部') },
            { value: '0', label: t('待处理') },
            { value: '1', label: t('已处理') },
          ]}
        />
      </div>
      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty description={t('暂无反馈')} />
        ) : (
          <Table
            columns={columns}
            dataSource={items}
            rowKey='id'
            pagination={{
              currentPage: page,
              pageSize: PAGE_SIZE,
              total,
              onPageChange: (p) => load(p),
            }}
          />
        )}
      </Spin>
    </Card>
  );
};

export default ModelFeedbackTable;
