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
import {
  Button,
  Col,
  Form,
  InputNumber,
  Row,
  Spin,
  Typography,
} from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
} from '../../../helpers';
import {
  quotaToDisplayAmount,
  displayAmountToQuota,
} from '../../../helpers/quota';
import { getCurrencyConfig } from '../../../helpers/render';
import { useTranslation } from 'react-i18next';

export default function SettingsDiceGame(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const currency = getCurrencyConfig();
  const currencySymbol = currency.type === 'TOKENS' ? '' : currency.symbol;
  const currencyPrecision = currency.type === 'TOKENS' ? 0 : 6;
  const [inputs, setInputs] = useState({
    'dice_game_setting.enabled': false,
    'dice_game_setting.show_entry': false,
    'dice_game_setting.min_bet': 500,
    'dice_game_setting.max_bet': 500000,
    'dice_game_setting.payout_rate': 2.0,
    'dice_game_setting.daily_max_plays': 3,
    'dice_game_setting.daily_reset_hour': 0,
    'dice_game_setting.welfare_balance_threshold': 5000000,
    'dice_game_setting.welfare_daily_grant': 15000000,
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((inputs) => ({ ...inputs, [fieldName]: value }));
    };
  }

  // 金额字段（存 quota，显示金额）变更：将输入的金额换算为 quota 存入
  function handleAmountChange(fieldName) {
    return (amount) => {
      const quota = displayAmountToQuota(amount);
      setInputs((inputs) => ({ ...inputs, [fieldName]: quota }));
    };
  }

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) =>
      API.put('/api/option/', {
        key: item.key,
        value: String(inputs[item.key]),
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
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
  }, [props.options]);

  const disabled = !inputs['dice_game_setting.enabled'];

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('小游戏设置')}>
            <Typography.Text
              type='tertiary'
              style={{ marginBottom: 16, display: 'block' }}
            >
              {t('幸运骰子：用户下注押大小，猜中按赔率返还；出现豹子庄家通吃。额度单位与站点一致。')}
            </Typography.Text>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8}>
                <Form.Switch
                  field={'dice_game_setting.enabled'}
                  label={t('启用小游戏')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('dice_game_setting.enabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Switch
                  field={'dice_game_setting.show_entry'}
                  label={t('显示侧边栏入口')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('dice_game_setting.show_entry')}
                  disabled={disabled}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.InputNumber
                  field={'dice_game_setting.payout_rate'}
                  label={t('猜中赔率')}
                  step={0.01}
                  min={1}
                  onChange={handleFieldChange('dice_game_setting.payout_rate')}
                  disabled={disabled}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.InputNumber
                  field={'dice_game_setting.daily_max_plays'}
                  label={t('每日最大局数')}
                  min={0}
                  onChange={handleFieldChange(
                    'dice_game_setting.daily_max_plays',
                  )}
                  disabled={disabled}
                />
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Select
                  field={'dice_game_setting.daily_reset_hour'}
                  label={t('每日限额重置时间')}
                  optionList={Array.from({ length: 24 }, (_, hour) => ({
                    label: t('每天 {{hour}}:00（北京时间）', {
                      hour: String(hour).padStart(2, '0'),
                    }),
                    value: hour,
                  }))}
                  onChange={handleFieldChange(
                    'dice_game_setting.daily_reset_hour',
                  )}
                  disabled={disabled}
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8}>
                <Form.Slot label={t('单局最小下注金额')}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={currencyPrecision}
                    prefix={currencySymbol}
                    value={quotaToDisplayAmount(inputs['dice_game_setting.min_bet'])}
                    onChange={handleAmountChange('dice_game_setting.min_bet')}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </Form.Slot>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Slot label={t('单局最大下注金额')}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={currencyPrecision}
                    prefix={currencySymbol}
                    value={quotaToDisplayAmount(inputs['dice_game_setting.max_bet'])}
                    onChange={handleAmountChange('dice_game_setting.max_bet')}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </Form.Slot>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Slot label={t('低保领取余额线')}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={currencyPrecision}
                    prefix={currencySymbol}
                    value={quotaToDisplayAmount(inputs['dice_game_setting.welfare_balance_threshold'])}
                    onChange={handleAmountChange('dice_game_setting.welfare_balance_threshold')}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </Form.Slot>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Form.Slot label={t('每日低保领取上限')}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={currencyPrecision}
                    prefix={currencySymbol}
                    value={quotaToDisplayAmount(inputs['dice_game_setting.welfare_daily_grant'])}
                    onChange={handleAmountChange('dice_game_setting.welfare_daily_grant')}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </Form.Slot>
              </Col>
            </Row>
          </Form.Section>
        </Form>
        <Button onClick={onSubmit}>{t('保存小游戏设置')}</Button>
      </Spin>
    </>
  );
}
