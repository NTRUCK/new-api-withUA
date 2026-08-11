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

import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Col,
  Form,
  Row,
  Spin,
  Typography,
  Table,
  InputNumber,
  Empty,
} from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

// 梯度 JSON [{from,to,multiplier}] 解析为行数组
function tiersToRows(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => ({
      from: t.from,
      to: t.to,
      multiplier: t.multiplier,
    }));
  } catch {
    return [];
  }
}

function rowsToTiersJSON(rows) {
  const arr = (rows || [])
    .filter((r) => Number.isFinite(+r.from) && +r.from >= 0)
    .map((r) => ({
      from: +r.from,
      to: r.to === '' || r.to == null ? -1 : +r.to,
      multiplier: +r.multiplier,
    }))
    .filter((r) => r.multiplier > 0);
  return JSON.stringify(arr);
}

export default function SettingsUserDailyTier(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    UserDailyTierEnabled: false,
    UserDailyTierAdminExempt: true,
    UserDailyTierResetHour: 0,
    UserDailyTierHardLimit: 0,
    UserDailyTier: '[]',
  });
  const [rows, setRows] = useState([]);
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((prev) => ({ ...prev, [fieldName]: value }));
    };
  }

  function updateRow(idx, key, value) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      const json = rowsToTiersJSON(next);
      setInputs((p) => ({ ...p, UserDailyTier: json }));
      return next;
    });
  }

  function addRow() {
    setRows((prev) => {
      const next = [...prev, { from: 0, to: -1, multiplier: 1 }];
      setInputs((p) => ({ ...p, UserDailyTier: rowsToTiersJSON(next) }));
      return next;
    });
  }

  function removeRow(idx) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setInputs((p) => ({ ...p, UserDailyTier: rowsToTiersJSON(next) }));
      return next;
    });
  }

  function onSubmit() {
    const payload = { ...inputs, UserDailyTier: rowsToTiersJSON(rows) };
    const updateArray = compareObjects(payload, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) =>
      API.put('/api/option/', {
        key: item.key,
        value: String(payload[item.key]),
      }),
    );
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        for (let i = 0; i < res.length; i++) {
          if (res[i] && !res[i].data.success) {
            return showError(res[i].data.message);
          }
        }
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
        currentInputs[key] = props.options[key];
      }
    }
    const merged = { ...inputs, ...currentInputs };
    // 数值字段转 number
    merged.UserDailyTierResetHour = parseInt(merged.UserDailyTierResetHour, 10) || 0;
    merged.UserDailyTierHardLimit = parseInt(merged.UserDailyTierHardLimit, 10) || 0;
    merged.UserDailyTierEnabled = merged.UserDailyTierEnabled === true || merged.UserDailyTierEnabled === 'true';
    merged.UserDailyTierAdminExempt = merged.UserDailyTierAdminExempt === true || merged.UserDailyTierAdminExempt === 'true';
    setInputs(merged);
    setInputsRow(structuredClone(merged));
    setRows(tiersToRows(merged.UserDailyTier));
    if (refForm.current) refForm.current.setValues(merged);
  }, [props.options]);

  const disabled = !inputs.UserDailyTierEnabled;

  const columns = [
    {
      title: t('起始次数'),
      dataIndex: 'from',
      render: (v, r, idx) => (
        <InputNumber
          value={v}
          min={0}
          onChange={(val) => updateRow(idx, 'from', val)}
          disabled={disabled}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: t('结束次数（-1 为不限）'),
      dataIndex: 'to',
      render: (v, r, idx) => (
        <InputNumber
          value={v}
          min={-1}
          onChange={(val) => updateRow(idx, 'to', val)}
          disabled={disabled}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: t('计费倍率'),
      dataIndex: 'multiplier',
      render: (v, r, idx) => (
        <InputNumber
          value={v}
          min={0.01}
          step={0.1}
          onChange={(val) => updateRow(idx, 'multiplier', val)}
          disabled={disabled}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: t('操作'),
      dataIndex: 'op',
      render: (v, r, idx) => (
        <Button
          icon={<IconDelete />}
          type='danger'
          theme='borderless'
          onClick={() => removeRow(idx)}
          disabled={disabled}
        />
      ),
    },
  ];

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(api) => (refForm.current = api)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('用户每日请求梯度计费')}>
            <Typography.Text
              type='tertiary'
              style={{ marginBottom: 16, display: 'block' }}
            >
              {t('按用户在各分组当天累计的成功请求次数独立计算梯度倍率，达到硬限额后拒绝该分组请求。仅统计成功调用。')}
            </Typography.Text>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8}>
                <Form.Switch
                  field={'UserDailyTierEnabled'}
                  label={t('启用用户每日梯度计费')}
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('UserDailyTierEnabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Switch
                  field={'UserDailyTierAdminExempt'}
                  label={t('管理员豁免（不统计/不限额）')}
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('UserDailyTierAdminExempt')}
                  disabled={disabled}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Select
                  field={'UserDailyTierResetHour'}
                  label={t('每日重置时间（北京时间）')}
                  optionList={Array.from({ length: 24 }, (_, h) => ({
                    label: `${String(h).padStart(2, '0')}:00${h === 0 ? '' : `（${t('非标准刷新')}）`}`,
                    value: h,
                  }))}
                  onChange={handleFieldChange('UserDailyTierResetHour')}
                  disabled={disabled}
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8}>
                <Form.InputNumber
                  field={'UserDailyTierHardLimit'}
                  label={t('每日硬限额（0 为不限）')}
                  min={0}
                  onChange={handleFieldChange('UserDailyTierHardLimit')}
                  disabled={disabled}
                />
              </Col>
            </Row>
            <Row>
              <Col span={24}>
                <Form.Slot label={t('计费梯度配置')}>
                  <div style={{ marginBottom: 8 }}>
                    <Text type='tertiary'>
                      {t('每行为一个梯度：当日请求次数落在 [起始, 结束] 区间时按对应倍率计费，结束次数填 -1 表示不限。')}
                    </Text>
                  </div>
                  <Table
                    size='small'
                    pagination={false}
                    dataSource={rows.map((r, i) => ({ ...r, key: i }))}
                    columns={columns}
                    empty={<Empty description={t('暂无梯度，点击下方按钮添加')} />}
                  />
                  <Button
                    icon={<IconPlus />}
                    onClick={addRow}
                    disabled={disabled}
                    style={{ marginTop: 8 }}
                  >
                    {t('添加梯度')}
                  </Button>
                </Form.Slot>
              </Col>
            </Row>
          </Form.Section>
        </Form>
        <Button onClick={onSubmit} loading={loading}>
          {t('保存梯度计费设置')}
        </Button>
      </Spin>
    </>
  );
}
