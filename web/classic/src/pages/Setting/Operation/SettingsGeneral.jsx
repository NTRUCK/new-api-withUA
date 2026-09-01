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
  Modal,
  Input,
  Select,
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
import { Plus, Trash2 } from 'lucide-react';

// 常用货币符号选项（管理员下拉选择）
const CURRENCY_SYMBOL_OPTIONS = [
  { value: '$', label: '$ 美元 USD' },
  { value: '¥', label: '¥ 人民币 CNY' },
  { value: '€', label: '€ 欧元 EUR' },
  { value: '£', label: '£ 英镑 GBP' },
  { value: '₩', label: '₩ 韩元 KRW' },
  { value: '₹', label: '₹ 卢比 INR' },
  { value: '₽', label: '₽ 卢布 RUB' },
  { value: '₫', label: '₫ 越南盾 VND' },
  { value: '฿', label: '฿ 泰铢 THB' },
  { value: '₱', label: '₱ 比索 PHP' },
  { value: '₺', label: '₺ 里拉 TRY' },
  { value: 'zł', label: 'zł 兹罗提 PLN' },
  { value: '₴', label: '₴ 格里夫纳 UAH' },
  { value: 'Rp', label: 'Rp 印尼盾 IDR' },
  { value: 'R$', label: 'R$ 雷亚尔 BRL' },
  { value: 'A$', label: 'A$ 澳元 AUD' },
  { value: 'C$', label: 'C$ 加元 CAD' },
  { value: 'HK$', label: 'HK$ 港币 HKD' },
  { value: 'NT$', label: 'NT$ 新台币 TWD' },
  { value: 'S$', label: 'S$ 新加坡元 SGD' },
  { value: '¤', label: '¤ 通用货币符号' },
];

// 若当前值不在预设列表中（如历史自定义符号），保留在选项首位
function getSymbolOptions(current, t) {
  const list = [...CURRENCY_SYMBOL_OPTIONS];
  if (current && !list.some((o) => o.value === current)) {
    list.unshift({ value: current, label: `${current} (${t('当前使用')})` });
  }
  return list;
}

const { Text } = Typography;

export default function GeneralSettings(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const [inputs, setInputs] = useState({
    TopUpLink: '',
    'general_setting.docs_link': '',
    'general_setting.quota_display_type': 'USD',
    'general_setting.custom_currency_symbol': '¤',
    'general_setting.custom_currency_exchange_rate': '',
    'general_setting.custom_currencies': '[]',
    QuotaPerUnit: '',
    RetryTimes: '',
    USDExchangeRate: '',
    DisplayTokenStatEnabled: false,
    DefaultCollapseSidebar: false,
    DemoSiteEnabled: false,
    SelfUseModeEnabled: false,
    'ranking_setting.exclude_admin_and_root': false,
    'token_setting.max_user_tokens': 1000,
    'general_setting.discord_enabled': false,
    'general_setting.discord_link': '',
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);
  // 预设自定义货币行编辑（inputs 中存 JSON 字符串）
  const [currencyRows, setCurrencyRows] = useState([]);

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((inputs) => ({ ...inputs, [fieldName]: value }));
    };
  }

  // JSON 字符串 -> 可编辑行数组
  function parseCurrencyRows(jsonStr) {
    try {
      const arr = jsonStr ? JSON.parse(jsonStr) : [];
      if (!Array.isArray(arr)) return [];
      return arr.map((c) => ({
        key: c?.key || '',
        name: c?.name || '',
        symbol: c?.symbol || '',
        rate: c?.rate_to_usd != null ? String(c.rate_to_usd) : '',
      }));
    } catch (e) {
      return [];
    }
  }

  // 行数组 -> 规范化 JSON 字符串（过滤无效行，自动补 key）
  function serializeCurrencyRows(rows) {
    const valid = rows.filter(
      (r) => (r.name || '').trim() && (r.symbol || '').trim() && parseFloat(r.rate) > 0,
    );
    const seen = new Set();
    return JSON.stringify(
      valid.map((r, i) => {
        let key = (r.key || '').trim();
        if (!key || seen.has(key)) key = `cur_${Date.now().toString(36)}_${i}`;
        seen.add(key);
        return {
          key,
          name: r.name.trim(),
          symbol: r.symbol.trim(),
          rate_to_usd: parseFloat(r.rate),
        };
      }),
    );
  }

  function updateCurrencyInputs(rows) {
    setCurrencyRows(rows);
    const json = serializeCurrencyRows(rows);
    setInputs((inputs) => ({
      ...inputs,
      'general_setting.custom_currencies': json,
    }));
  }

  function updateCurrencyRow(idx, field, value) {
    const rows = currencyRows.map((r, i) =>
      i === idx ? { ...r, [field]: value } : r,
    );
    updateCurrencyInputs(rows);
  }

  function addCurrencyRow() {
    updateCurrencyInputs([
      ...currencyRows,
      { key: '', name: '', symbol: '', rate: '' },
    ]);
  }

  function removeCurrencyRow(idx) {
    updateCurrencyInputs(currencyRows.filter((_, i) => i !== idx));
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

  // 计算展示在输入框中的“1 USD = X <currency>”中的 X
  const combinedRate = useMemo(() => {
    const type = inputs['general_setting.quota_display_type'];
    if (type === 'USD') return '1';
    if (type === 'CNY') return String(inputs['USDExchangeRate'] || '');
    if (type === 'TOKENS') return String(inputs['QuotaPerUnit'] || '');
    if (type === 'CUSTOM')
      return String(
        inputs['general_setting.custom_currency_exchange_rate'] || '',
      );
    return '';
  }, [inputs]);

  const onCombinedRateChange = (val) => {
    const type = inputs['general_setting.quota_display_type'];
    if (type === 'CNY') {
      handleFieldChange('USDExchangeRate')(val);
    } else if (type === 'TOKENS') {
      handleFieldChange('QuotaPerUnit')(val);
    } else if (type === 'CUSTOM') {
      handleFieldChange('general_setting.custom_currency_exchange_rate')(val);
    }
  };

  const showTokensOption = useMemo(() => {
    const initialType = props.options?.['general_setting.quota_display_type'];
    const initialQuotaPerUnit = parseFloat(props.options?.QuotaPerUnit);
    const legacyTokensMode =
      initialType === undefined &&
      props.options?.DisplayInCurrencyEnabled !== undefined &&
      !props.options.DisplayInCurrencyEnabled;
    return (
      initialType === 'TOKENS' ||
      legacyTokensMode ||
      (!isNaN(initialQuotaPerUnit) && initialQuotaPerUnit !== 500000)
    );
  }, [props.options]);

  const quotaDisplayType = inputs['general_setting.quota_display_type'];

  const quotaDisplayTypeDesc = useMemo(() => {
    const descMap = {
      USD: t('站点所有额度将以美元 ($) 显示'),
      CNY: t('站点所有额度将按汇率换算为人民币 (¥) 显示'),
      TOKENS: t('站点所有额度将以原始 Token 数显示，不做货币换算'),
      CUSTOM: t('站点所有额度将按汇率换算为自定义货币显示'),
    };
    return descMap[quotaDisplayType] || '';
  }, [quotaDisplayType, t]);

  const rateLabel = useMemo(() => {
    if (quotaDisplayType === 'CNY') return t('汇率');
    if (quotaDisplayType === 'TOKENS') return t('每美元对应 Token 数');
    if (quotaDisplayType === 'CUSTOM') return t('汇率');
    return '';
  }, [quotaDisplayType, t]);

  const rateSuffix = useMemo(() => {
    if (quotaDisplayType === 'CNY') return 'CNY (¥)';
    if (quotaDisplayType === 'TOKENS') return 'Tokens';
    if (quotaDisplayType === 'CUSTOM')
      return inputs['general_setting.custom_currency_symbol'] || '¤';
    return '';
  }, [quotaDisplayType, inputs]);

  const rateExtraText = useMemo(() => {
    if (quotaDisplayType === 'CNY')
      return t(
        '系统内部以美元 (USD) 为基准计价。用户余额、充值金额、模型定价、用量日志等所有金额显示均按此汇率换算为人民币，不影响内部计费',
      );
    if (quotaDisplayType === 'TOKENS')
      return t(
        '系统内部计费精度，默认 500000，修改可能导致计费异常，请谨慎操作',
      );
    if (quotaDisplayType === 'CUSTOM')
      return t(
        '系统内部以美元 (USD) 为基准计价。用户余额、充值金额、模型定价、用量日志等所有金额显示均按此汇率换算为自定义货币，不影响内部计费',
      );
    return '';
  }, [quotaDisplayType, t]);

  const previewText = useMemo(() => {
    if (quotaDisplayType === 'USD') return '$1.00';
    const rate = parseFloat(combinedRate);
    if (!rate || isNaN(rate)) return t('请输入汇率');
    if (quotaDisplayType === 'CNY') return `$1.00 → ¥${rate.toFixed(2)}`;
    if (quotaDisplayType === 'TOKENS')
      return `$1.00 → ${Number(rate).toLocaleString()} Tokens`;
    if (quotaDisplayType === 'CUSTOM') {
      const symbol = inputs['general_setting.custom_currency_symbol'] || '¤';
      return `$1.00 → ${symbol}${rate.toFixed(2)}`;
    }
    return '';
  }, [quotaDisplayType, combinedRate, inputs, t]);

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
    // 若旧字段存在且新字段缺失，则做一次兜底映射
    if (
      currentInputs['general_setting.quota_display_type'] === undefined &&
      props.options?.DisplayInCurrencyEnabled !== undefined
    ) {
      currentInputs['general_setting.quota_display_type'] = props.options
        .DisplayInCurrencyEnabled
        ? 'USD'
        : 'TOKENS';
    }
    // 回填自定义货币相关字段（如果后端已存在）
    if (props.options['general_setting.custom_currency_symbol'] !== undefined) {
      currentInputs['general_setting.custom_currency_symbol'] =
        props.options['general_setting.custom_currency_symbol'];
    }
    if (
      props.options['general_setting.custom_currency_exchange_rate'] !==
      undefined
    ) {
      currentInputs['general_setting.custom_currency_exchange_rate'] =
        props.options['general_setting.custom_currency_exchange_rate'];
    }
    // 预设货币列表兜底：后端未保存过该 key 时（options 表无此行），
    // 必须补默认值 '[]'，否则 inputsRow 缺失该 key，
    // compareObjects 只遍历旧对象 key，将永远检测不到变更导致无法保存
    if (currentInputs['general_setting.custom_currencies'] === undefined) {
      currentInputs['general_setting.custom_currencies'] = '[]';
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
    setCurrencyRows(parseCurrencyRows(currentInputs['general_setting.custom_currencies']));
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('通用设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Input
                  field={'TopUpLink'}
                  label={t('充值链接')}
                  initValue={''}
                  placeholder={t('例如发卡网站的购买链接')}
                  onChange={handleFieldChange('TopUpLink')}
                  showClear
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Input
                  field={'general_setting.docs_link'}
                  label={t('文档地址')}
                  initValue={''}
                  placeholder={t('例如 https://docs.newapi.pro')}
                  onChange={handleFieldChange('general_setting.docs_link')}
                  showClear
                />
              </Col>
              {/* 单位美元额度已合入汇率组合控件（TOKENS 模式下编辑），不再单独展示 */}
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Input
                  field={'RetryTimes'}
                  label={t('失败重试次数')}
                  initValue={''}
                  placeholder={t('失败重试次数')}
                  onChange={handleFieldChange('RetryTimes')}
                  showClear
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Select
                  field='general_setting.quota_display_type'
                  label={t('额度展示类型')}
                  extraText={quotaDisplayTypeDesc}
                  onChange={handleFieldChange(
                    'general_setting.quota_display_type',
                  )}
                >
                  <Form.Select.Option value='USD'>
                    USD ($)
                  </Form.Select.Option>
                  <Form.Select.Option value='CNY'>
                    CNY (¥)
                  </Form.Select.Option>
                  {showTokensOption && (
                    <Form.Select.Option value='TOKENS'>
                      Tokens
                    </Form.Select.Option>
                  )}
                  <Form.Select.Option value='CUSTOM'>
                    {t('自定义货币')}
                  </Form.Select.Option>
                </Form.Select>
              </Col>
              {quotaDisplayType !== 'USD' && (
                <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                  <Form.Slot label={rateLabel}>
                    <Input
                      prefix='1 USD = '
                      suffix={rateSuffix}
                      value={combinedRate}
                      onChange={onCombinedRateChange}
                    />
                    <Text
                      type='tertiary'
                      size='small'
                      style={{ marginTop: 4, display: 'block' }}
                    >
                      {rateExtraText}
                    </Text>
                  </Form.Slot>
                </Col>
              )}
              <Col
                xs={24}
                sm={12}
                md={8}
                lg={8}
                xl={8}
                style={
                  quotaDisplayType !== 'CUSTOM'
                    ? { display: 'none' }
                    : undefined
                }
              >
                <Form.Select
                  field='general_setting.custom_currency_symbol'
                  label={t('自定义货币符号')}
                  extraText={t(
                    '自定义货币符号将显示在所有额度数值前，例如 €1.50',
                  )}
                  placeholder={t('请选择货币符号')}
                  filter
                  optionList={getSymbolOptions(
                    inputs['general_setting.custom_currency_symbol'],
                    t,
                  )}
                  onChange={handleFieldChange(
                    'general_setting.custom_currency_symbol',
                  )}
                />
              </Col>
              <Col span={24}>
                <Text type='tertiary' size='small'>
                  {t('预览效果')}：{previewText}
                </Text>
              </Col>
            </Row>
            {/* 预设自定义货币：成员可在个人设置中选择展示货币，仅能从此列表选择 */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.Slot
                  label={t('预设自定义货币')}
                  extraText={t(
                    '配置后成员可在 个人设置-偏好设置 中选择余额展示货币，仅能从此列表选择，不能自定义；留空则成员跟随站点默认展示',
                  )}
                >
                  {currencyRows.length === 0 && (
                    <Text type='tertiary' size='small'>
                      {t('尚未配置，成员将跟随站点默认展示')}
                    </Text>
                  )}
                  {currencyRows.map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Input
                        placeholder={t('名称，如 猫粮')}
                        style={{ width: 150 }}
                        value={row.name}
                        onChange={(v) => updateCurrencyRow(idx, 'name', v)}
                      />
                      <Select
                        placeholder={t('请选择符号')}
                        style={{ width: 180 }}
                        value={row.symbol || undefined}
                        filter
                        optionList={getSymbolOptions(row.symbol, t)}
                        onChange={(v) => updateCurrencyRow(idx, 'symbol', v)}
                      />
                      <Input
                        prefix='1 USD ='
                        style={{ width: 170 }}
                        placeholder='10'
                        value={row.rate}
                        onChange={(v) => updateCurrencyRow(idx, 'rate', v)}
                      />
                      <Button
                        type='danger'
                        theme='borderless'
                        icon={<Trash2 size={16} />}
                        onClick={() => removeCurrencyRow(idx)}
                      />
                    </div>
                  ))}
                  <Button
                    theme='light'
                    icon={<Plus size={14} />}
                    onClick={addCurrencyRow}
                  >
                    {t('添加货币')}
                  </Button>
                </Form.Slot>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'DisplayTokenStatEnabled'}
                  label={t('额度查询接口返回令牌额度而非用户额度')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('DisplayTokenStatEnabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'DefaultCollapseSidebar'}
                  label={t('默认折叠侧边栏')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('DefaultCollapseSidebar')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'DemoSiteEnabled'}
                  label={t('演示站点模式')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('DemoSiteEnabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'SelfUseModeEnabled'}
                  label={t('自用模式')}
                  extraText={t('开启后不限制：必须设置模型倍率')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('SelfUseModeEnabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'ranking_setting.exclude_admin_and_root'}
                  label={t('富豪榜和调用榜排除管理员')}
                  extraText={t('开启后排除管理员、超级管理员和 User ID 1')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange(
                    'ranking_setting.exclude_admin_and_root',
                  )}
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('用户最大令牌数量')}
                  field={'token_setting.max_user_tokens'}
                  step={1}
                  min={1}
                  extraText={t('每个用户最多可创建的令牌数量，默认 1000，设置过大可能会影响性能')}
                  placeholder={'1000'}
                  onChange={handleFieldChange('token_setting.max_user_tokens')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'general_setting.discord_enabled'}
                  label={t('页脚显示 Discord 社区入口')}
                  extraText={t(
                    '开启后页脚展示"加入 Discord 社区"跳转链接，需同时填写链接',
                  )}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange(
                    'general_setting.discord_enabled',
                  )}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Input
                  field={'general_setting.discord_link'}
                  label={t('Discord 社区链接')}
                  initValue={''}
                  placeholder={t('例如 https://discord.gg/xxxxxxxx')}
                  onChange={handleFieldChange('general_setting.discord_link')}
                  showClear
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存通用设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>

      <Modal
        title={t('警告')}
        visible={showQuotaWarning}
        onOk={() => setShowQuotaWarning(false)}
        onCancel={() => setShowQuotaWarning(false)}
        closeOnEsc={true}
        width={500}
      >
        <Banner
          type='warning'
          description={t(
            '此设置用于系统内部计算，默认值500000是为了精确到6位小数点设计，不推荐修改。',
          )}
          bordered
          fullMode={false}
          closeIcon={null}
        />
      </Modal>
    </>
  );
}
