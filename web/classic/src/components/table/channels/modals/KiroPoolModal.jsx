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

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Button,
  Table,
  Tag,
  Typography,
  Banner,
  Spin,
  Descriptions,
  Progress,
  InputNumber,
  Space,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API, showError, showSuccess, timestamp2string } from '../../../../helpers';

const { Text } = Typography;

const PLAN_LABELS = {
  pro: 'Pro ($20 / 1,000 cr)',
  pro_plus: 'Pro+ ($40 / 2,000 cr)',
  pro_max: 'Pro Max ($100 / 5,000 cr)',
  power: 'Power ($200 / 10,000 cr)',
};

const fmt = (v, digits = 2) => {
  const n = Number(v) || 0;
  return n.toFixed(digits);
};

const KiroPoolModal = ({ visible, onCancel, channel }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [initialUsed, setInitialUsed] = useState(0);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!channel || !channel.id) return;
    setLoading(true);
    try {
      const res = await API.get(`/api/channel/kiro_usage/${channel.id}`);
      if (res.data?.success) {
        setData(res.data.data);
        setInitialUsed(Number(res.data.data.used_initial) || 0);
      } else {
        showError(res.data?.message || t('获取号池数据失败'));
      }
    } catch (e) {
      showError(t('获取号池数据失败'));
    } finally {
      setLoading(false);
    }
  }, [channel, t]);

  useEffect(() => {
    if (visible && channel) {
      fetchData();
    }
    if (!visible) {
      setData(null);
      setInitialUsed(0);
    }
  }, [visible, channel, fetchData]);

  const saveInitial = async () => {
    if (!channel || !channel.id) return;
    const v = Number(initialUsed);
    if (Number.isNaN(v) || v < 0) {
      showError(t('期初已用必须是非负数'));
      return;
    }
    setSaving(true);
    try {
      const res = await API.post(`/api/channel/kiro_calibrate/${channel.id}`, {
        used_initial: Math.round(v),
      });
      if (res.data?.success) {
        showSuccess(t('校准已生效'));
        await fetchData();
      } else {
        showError(res.data?.message || t('校准失败'));
      }
    } catch (e) {
      showError(t('校准失败'));
    } finally {
      setSaving(false);
    }
  };

  const planText = () => {
    if (!data) return '-';
    const tpl = data.plan_template;
    const label = tpl && PLAN_LABELS[tpl] ? PLAN_LABELS[tpl] : t('自定义');
    return data.plan_count > 0 ? `${label} × ${data.plan_count}` : label;
  };

  const limit = data ? Number(data.limit) || 0 : 0;
  const used = data ? Number(data.used) || 0 : 0;
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const statusText =
    limit <= 0
      ? t('仅记录（未设总额度）')
      : data.used >= limit
        ? t('已熔断：所有账号已用尽')
        : t('正常');

  const dayColumns = [
    { title: t('日期'), dataIndex: 'date' },
    { title: t('请求数'), dataIndex: 'reqs' },
    {
      title: t('credits 消耗'),
      dataIndex: 'credits',
      render: (v) => fmt(v, 3),
    },
  ];

  const recentColumns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      render: (v) => timestamp2string(v),
    },
    {
      title: t('模型'),
      dataIndex: 'model_name',
      render: (v, r) => (
        <Space>
          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>
            {v}
          </Text>
          {r.mult > 0 && (
            <Tag size='small' color='amber'>
              {fmt(r.mult, 1)}x
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('输入 / 输出 tokens'),
      render: (text, r) =>
        `${(Number(r.prompt_tokens) || 0).toLocaleString()} / ${(Number(r.completion_tokens) || 0).toLocaleString()}`,
    },
    {
      title: t('credits'),
      dataIndex: 'credits',
      render: (v) => fmt(v, 3),
    },
  ];

  return (
    <Modal
      title={channel ? `${t('Kiro 号池数据')} - ${channel.name || `#${channel.id}`}` : t('Kiro 号池数据')}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={Math.min(1100, Math.max(720, typeof window !== 'undefined' ? window.innerWidth - 100 : 1000))}
      bodyStyle={{ maxHeight: '75vh', overflowY: 'auto' }}
    >
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size='large' />
        </div>
      ) : !data ? null : !data.sim_enabled ? (
        <Banner type='info' closeIcon={null}>
          {t('该渠道未开启 Kiro 额度模拟')}
        </Banner>
      ) : (
        <div className='space-y-4'>
          {data.exhausted && (
            <Banner type='danger' closeIcon={null}>
              {t(
                '号池已耗尽：非管理员请求该渠道将返回 503「所有账号已用尽」，可在下方校准期初已用来恢复（管理员请求不受熔断限制）',
              )}
            </Banner>
          )}

          <Descriptions
            row
            size='small'
            data={[
              { key: t('套餐档位'), value: planText() },
              {
                key: t('基线'),
                value:
                  Number(data.tokens_per_credit) > 0
                    ? `${data.tokens_per_credit} / cr`
                    : `50000 / cr ${t('(默认)')}`,
              },
              { key: t('统计月份'), value: data.month || '-' },
              { key: t('状态'), value: statusText },
            ]}
          />

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text strong>
                {t('已用')}：{fmt(used, 2)} / {fmt(limit)} cr
              </Text>
              <Text type={limit > 0 && data.remaining <= 0 ? 'danger' : 'tertiary'}>
                {t('剩余')}：{fmt(data.remaining, 2)} cr
              </Text>
            </div>
            <Progress percent={percent} showInput stroke={data.exhausted ? 'var(--semi-color-danger)' : undefined} />
            <div style={{ marginTop: 4 }}>
              <Text type='tertiary' size='small'>
                {t('本月日志累计')} {fmt(data.log_used, 3)} {t('cr + 期初已用')} {fmt(data.used_initial, 0)} {t('cr')}
              </Text>
            </div>
          </div>

          <div>
            <Text strong>{t('期初已用校准')}</Text>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <InputNumber
                value={initialUsed}
                min={0}
                step={100}
                style={{ width: 180 }}
                onChange={(v) => setInitialUsed(v)}
              />
              <Button
                icon={<IconRefresh />}
                loading={saving}
                onClick={saveInitial}
              >
                {t('保存校准')}
              </Button>
              <Text type='tertiary' size='small'>
                {t('例如填 1500 表示号池开始时已用 1500 cr，烧到月度总额即熔断；下次测试时手动改回 0 即可')}
              </Text>
            </div>
          </div>

          <div>
            <Text strong>{t('按日消耗（本月）')}</Text>
            <Table
              size='small'
              columns={dayColumns}
              dataSource={data.daily || []}
              pagination={false}
              empty={t('本月暂无消耗')}
              style={{ marginTop: 6 }}
            />
          </div>

          <div>
            <Text strong>{t('最近消费明细（含未开启模拟时期的历史）')}</Text>
            <Table
              size='small'
              columns={recentColumns}
              dataSource={data.recent || []}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              empty={t('暂无明细')}
              style={{ marginTop: 6 }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default KiroPoolModal;
