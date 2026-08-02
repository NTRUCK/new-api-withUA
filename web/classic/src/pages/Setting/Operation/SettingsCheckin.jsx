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

import React, { useEffect, useState, useRef } from 'react';
import { Button, Col, Form, Row, Spin, Typography } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  verifyJSON,
} from '../../../helpers';
import {
  quotaToDisplayAmount,
  displayAmountToQuota,
  getQuotaPerUnit,
} from '../../../helpers/quota';
import { getCurrencyConfig } from '../../../helpers/render';
import { useTranslation } from 'react-i18next';

export default function SettingsCheckin(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  // 额度换算小工具：金额 <-> quota（用于填写下方梯度 JSON 的 quota 数值）
  const [convAmount, setConvAmount] = useState(10);
  const [convQuota, setConvQuota] = useState(displayAmountToQuota(10));
  const currencySymbol = getCurrencyConfig().symbol;
  const [inputs, setInputs] = useState({
    'checkin_setting.enabled': false,
    'checkin_setting.min_quota': 1000,
    'checkin_setting.max_quota': 10000,
    'checkin_setting.tiers': '[]',
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

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
        value = String(inputs[item.key]);
      }
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        for (let i = 0; i < res.length; i++) {
          if (res[i] && !res[i].data.success) {
            return showError(res[i].data.message);
          }
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const currentInputs = {};
    for (let key in props.options) {
      if (Object.keys(inputs).includes(key)) {
        currentInputs[key] = props.options[key];
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('签到设置')}>
            <Typography.Text
              type='tertiary'
              style={{ marginBottom: 16, display: 'block' }}
            >
              {t('签到功能允许用户每日签到获取随机额度奖励')}
            </Typography.Text>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'checkin_setting.enabled'}
                  label={t('启用签到功能')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('checkin_setting.enabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.min_quota'}
                  label={t('默认签到最小额度')}
                  placeholder={t('签到奖励的最小额度')}
                  onChange={handleFieldChange('checkin_setting.min_quota')}
                  min={0}
                  disabled={!inputs['checkin_setting.enabled']}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.max_quota'}
                  label={t('默认签到最大额度')}
                  placeholder={t('签到奖励的最大额度')}
                  onChange={handleFieldChange('checkin_setting.max_quota')}
                  min={0}
                  disabled={!inputs['checkin_setting.enabled']}
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Form.Slot label={t('额度换算工具')}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography.Text type='tertiary'>
                      {t('金额')}
                    </Typography.Text>
                    <Form.InputNumber
                      noLabel
                      field='__conv_amount'
                      prefix={currencySymbol}
                      precision={6}
                      min={0}
                      step={0.000001}
                      initValue={convAmount}
                      style={{ width: 160 }}
                      onChange={(v) => {
                        const amount = Number(v || 0);
                        setConvAmount(amount);
                        setConvQuota(displayAmountToQuota(amount));
                      }}
                    />
                    <Typography.Text type='tertiary'>=</Typography.Text>
                    <Form.InputNumber
                      noLabel
                      field='__conv_quota'
                      min={0}
                      step={1}
                      initValue={convQuota}
                      style={{ width: 200 }}
                      onChange={(v) => {
                        const quota = Number(v || 0);
                        setConvQuota(quota);
                        setConvAmount(
                          Number(quotaToDisplayAmount(quota).toFixed(6)),
                        );
                      }}
                    />
                    <Typography.Text type='tertiary'>quota</Typography.Text>
                  </div>
                  <Typography.Text
                    type='tertiary'
                    size='small'
                    style={{ display: 'block', marginTop: 4 }}
                  >
                    {t('当前换算比例：1')}
                    {currencySymbol} = {getQuotaPerUnit()} quota。
                    {t('在此换算后，将 quota 值填入下方梯度 JSON。')}
                  </Typography.Text>
                </Form.Slot>
              </Col>
            </Row>
            <Row>
              <Col xs={24} sm={16}>
                <Form.TextArea
                  label={t('签到额度梯度（可选）')}
                  field={'checkin_setting.tiers'}
                  placeholder={
                    '[\n  {"min_balance": 25000000, "min_quota": 1, "max_quota": 1}\n]'
                  }
                  autosize={{ minRows: 5, maxRows: 16 }}
                  trigger='blur'
                  stopValidateWithError
                  disabled={!inputs['checkin_setting.enabled']}
                  rules={[
                    {
                      validator: (rule, value) => !value || verifyJSON(value),
                      message: t('不是合法的 JSON 字符串'),
                    },
                  ]}
                  extraText={
                    <div>
                      <p>{t('说明：')}</p>
                      <ul>
                        <li>
                          {t(
                            '数组格式，每档为：{"min_balance": 剩余额度阈值, "min_quota": 最小奖励, "max_quota": 最大奖励}',
                          )}
                        </li>
                        <li>
                          {t(
                            '按用户当前剩余额度从高到低匹配，命中第一个满足 剩余额度 >= min_balance 的档；未命中任何档则使用上方默认额度。',
                          )}
                        </li>
                        <li>
                          {t(
                            '额度单位为 quota（500000 ≈ $1）。示例：min_balance 25000000 约等于 $50。',
                          )}
                        </li>
                        <li>
                          {t(
                            '示例：[{"min_balance": 25000000, "min_quota": 1, "max_quota": 1}] 表示剩余额度高于约 $50 的用户，每次签到仅奖励 1。',
                          )}
                        </li>
                        <li>{t('留空则对所有用户使用上方默认额度。')}</li>
                      </ul>
                    </div>
                  }
                  onChange={handleFieldChange('checkin_setting.tiers')}
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存签到设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
