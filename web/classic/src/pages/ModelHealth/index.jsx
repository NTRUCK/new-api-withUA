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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Empty,
  Input,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

const HOURS_OPTIONS = [
  { labelKey: '近 1 小时', value: 1 },
  { labelKey: '近 24 小时', value: 24 },
  { labelKey: '近 7 天', value: 24 * 7 },
];

const rateColor = (rate) => {
  if (rate >= 95) return 'green';
  if (rate >= 90) return 'amber';
  if (rate >= 60) return 'orange';
  return 'red';
};

const ModelHealth = () => {
  const { t } = useTranslation();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(1);
  const [keyword, setKeyword] = useState('');

  const load = async (h) => {
    setLoading(true);
    try {
      const res = await API.get(`/api/perf-metrics/summary?hours=${h}`);
      const { success, message, data } = res.data;
      if (!success) return showError(message);
      setModels(data?.models || []);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(hours);
  }, [hours]);

  const filteredModels = useMemo(() => {
    if (!keyword) return models;
    const kw = keyword.toLowerCase();
    return models.filter((m) => m.model_name.toLowerCase().includes(kw));
  }, [models, keyword]);

  const overview = useMemo(() => {
    let totalReq = 0;
    let weightedSuccess = 0;
    filteredModels.forEach((m) => {
      const rc = m.request_count || 0;
      totalReq += rc;
      weightedSuccess += (m.success_rate || 0) * rc;
    });
    const globalRate = totalReq > 0 ? weightedSuccess / totalReq : 0;
    return {
      modelCount: filteredModels.length,
      totalReq,
      globalRate,
    };
  }, [filteredModels]);

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      render: (text) => <Typography.Text strong>{text}</Typography.Text>,
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      sorter: (a, b) => (a.success_rate || 0) - (b.success_rate || 0),
      render: (rate) => (
        <Tag color={rateColor(rate || 0)} shape='circle'>
          {(rate || 0).toFixed(1)}%
        </Tag>
      ),
    },
    {
      title: t('请求数'),
      dataIndex: 'request_count',
      sorter: (a, b) => (a.request_count || 0) - (b.request_count || 0),
      render: (v) => (v || 0).toLocaleString(),
    },
    {
      title: t('平均延迟'),
      dataIndex: 'avg_latency_ms',
      sorter: (a, b) => (a.avg_latency_ms || 0) - (b.avg_latency_ms || 0),
      render: (v) => `${(v || 0).toLocaleString()} ms`,
    },
    {
      title: t('平均吞吐 (TPS)'),
      dataIndex: 'avg_tps',
      sorter: (a, b) => (a.avg_tps || 0) - (b.avg_tps || 0),
      render: (v) => (v || 0).toFixed(2),
    },
  ];

  return (
    <div className='mt-[60px] max-w-6xl mx-auto px-4 py-8'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
        <Typography.Title heading={2}>{t('模型健康')}</Typography.Title>
        <div className='flex items-center gap-2'>
          <Input
            prefix='🔍'
            showClear
            placeholder={t('搜索模型')}
            value={keyword}
            onChange={(v) => setKeyword(v)}
            style={{ width: 200 }}
          />
          <Select value={hours} onChange={(v) => setHours(v)} style={{ width: 130 }}>
            {HOURS_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>

      <div className='grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6'>
        <Card className='!rounded-xl'>
          <Typography.Text type='tertiary'>{t('监控模型数')}</Typography.Text>
          <div className='text-2xl font-bold mt-1'>{overview.modelCount}</div>
        </Card>
        <Card className='!rounded-xl'>
          <Typography.Text type='tertiary'>{t('全局成功率')}</Typography.Text>
          <div className='text-2xl font-bold mt-1'>
            {overview.globalRate.toFixed(1)}%
          </div>
        </Card>
        <Card className='!rounded-xl'>
          <Typography.Text type='tertiary'>{t('总请求数')}</Typography.Text>
          <div className='text-2xl font-bold mt-1'>
            {overview.totalReq.toLocaleString()}
          </div>
        </Card>
      </div>

      <Spin spinning={loading} style={{ width: '100%' }}>
        {filteredModels.length === 0 && !loading ? (
          <Empty description={t('暂无监控数据')} />
        ) : (
          <Card className='!rounded-xl'>
            <Table
              columns={columns}
              dataSource={filteredModels}
              rowKey='model_name'
              pagination={{ pageSize: 20 }}
              size='small'
            />
          </Card>
        )}
      </Spin>
    </div>
  );
};

export default ModelHealth;
