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

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Banner,
  Button,
  Col,
  Form,
  Row,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  toBoolean,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function SettingsRetry524(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    RetryOn524Enabled: false,
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  // 只读统计值：按渠道聚合的 524 统计（后端持久化的 JSON）
  const statsRows = useMemo(() => {
    const raw = props.options?.RetryOn524Stats;
    if (!raw) return [];
    let parsed = {};
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return [];
    }
    return Object.keys(parsed)
      .map((id) => {
        const s = parsed[id] || {};
        return {
          channelId: Number(id),
          triggerCount: s.trigger_count ?? 0,
          retryCount: s.retry_count ?? 0,
          upstreamCount: s.upstream_count ?? 0,
        };
      })
      .sort((a, b) => b.retryCount - a.retryCount);
  }, [props.options]);

  const totals = useMemo(
    () =>
      statsRows.reduce(
        (acc, r) => {
          acc.triggerCount += r.triggerCount;
          acc.retryCount += r.retryCount;
          acc.upstreamCount += r.upstreamCount;
          return acc;
        },
        { triggerCount: 0, retryCount: 0, upstreamCount: 0 },
      ),
    [statsRows],
  );

  const columns = [
    { title: t('渠道 ID'), dataIndex: 'channelId', width: 100 },
    {
      title: t('524 触发次数'),
      dataIndex: 'triggerCount',
      render: (v) => (
        <Tag color='red' size='large'>
          {v}
        </Tag>
      ),
    },
    {
      title: t('实际重试次数'),
      dataIndex: 'retryCount',
      render: (v) => (
        <Tag color='orange' size='large'>
          {v}
        </Tag>
      ),
    },
    {
      title: t('上游总请求次数'),
      dataIndex: 'upstreamCount',
      render: (v) => (
        <Tag color='blue' size='large'>
          {v}
        </Tag>
      ),
    },
    {
      title: t('524 占比'),
      dataIndex: 'ratio',
      render: (_, r) =>
        r.upstreamCount > 0
          ? `${((r.triggerCount / r.upstreamCount) * 100).toFixed(1)}%`
          : '-',
    },
  ];

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((inputs) => ({ ...inputs, [fieldName]: value }));
    };
  }

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        value = inputs[item.key];
      }
      return API.put('/api/option/', { key: item.key, value });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (res.includes(undefined)) return showError(t('部分保存失败，请重试'));
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => showError(t('保存失败，请重试')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const currentInputs = {};
    for (let key in props.options) {
      if (Object.keys(inputs).includes(key)) {
        currentInputs[key] =
          typeof inputs[key] === 'boolean'
            ? toBoolean(props.options[key])
            : props.options[key];
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current && refForm.current.setValues(currentInputs);
  }, [props.options]);

  return (
    <Spin spinning={loading}>
      <Form
        values={inputs}
        getFormApi={(formAPI) => (refForm.current = formAPI)}
        style={{ marginBottom: 15 }}
      >
        <Form.Section text={t('524 超时重试')}>
          <Row>
            <Col span={24}>
              <Banner
                type='info'
                fullMode={false}
                closeIcon={null}
                description={t(
                  '部分上游经 Cloudflare 代理，对超长上下文或长耗时生成的请求，会在源站响应超过约 125 秒时返回 524（源站已在计费并生成，但结果被网关掐断）。开启后，遇到 524 将自动切换下一个 Key 重试（受“失败重试次数”限制），可显著降低用户侧 524 报错，但会额外消耗上游按次计费的调用次数。若用户使用的客户端（如酒馆插件）已具备自动重试，可关闭本开关。',
                )}
                style={{ marginBottom: 12 }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8} lg={8} xl={8}>
              <Form.Switch
                field={'RetryOn524Enabled'}
                label={t('开启 524 自动重试')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                extraText={t(
                  '依赖“通用设置-失败重试次数”，建议设为 2-3 次；多 Key 渠道每次重试会自动更换 Key',
                )}
                onChange={handleFieldChange('RetryOn524Enabled')}
              />
            </Col>
          </Row>
          <Row>
            <Button size='default' onClick={onSubmit}>
              {t('保存')}
            </Button>
          </Row>
          <Row style={{ marginTop: 20 }}>
            <Col span={24}>
              <Form.Slot label={t('各渠道 524 消耗统计')}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color='red' size='large' style={{ marginRight: 8 }}>
                    {t('触发合计')}：{totals.triggerCount}
                  </Tag>
                  <Tag color='orange' size='large' style={{ marginRight: 8 }}>
                    {t('重试合计')}：{totals.retryCount}
                  </Tag>
                  <Tag color='blue' size='large'>
                    {t('上游请求合计')}：{totals.upstreamCount}
                  </Tag>
                </div>
                <Table
                  columns={columns}
                  dataSource={statsRows}
                  rowKey='channelId'
                  size='small'
                  pagination={false}
                  empty={t('暂无 524 统计数据（开关开启且发生 524 后显示）')}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ marginTop: 6, display: 'block' }}
                >
                  {t(
                    '触发次数=524 报错次数；实际重试次数=因 524 真正向上游重发的次数（额外消耗的按次计费调用）；上游总请求次数用作 524 占比分母。统计持久化保存，可在数据库 options 表中将 RetryOn524Stats 置为 {} 以重置。',
                  )}
                </Text>
              </Form.Slot>
            </Col>
          </Row>
        </Form.Section>
      </Form>
    </Spin>
  );
}
