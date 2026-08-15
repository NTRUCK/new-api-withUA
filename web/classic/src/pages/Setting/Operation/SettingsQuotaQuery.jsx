import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, InputNumber, Row, Spin, Typography } from '@douyinfe/semi-ui';
import { API, compareObjects, showError, showSuccess, showWarning } from '../../../helpers';
import { displayAmountToQuota, quotaToDisplayAmount } from '../../../helpers/quota';
import { getCurrencyConfig } from '../../../helpers/render';
import { useTranslation } from 'react-i18next';

export default function SettingsQuotaQuery(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const refForm = useRef();
  const currency = getCurrencyConfig();
  const [inputs, setInputs] = useState({
    'quota_query_setting.enabled': false,
    'quota_query_setting.show_entry': false,
    'quota_query_setting.fee': 500000,
    'quota_query_setting.daily_limit': 3,
    'quota_query_setting.allow_admin_and_root': false,
  });
  const [initial, setInitial] = useState(inputs);
  const change = (key) => (value) => setInputs((old) => ({ ...old, [key]: value }));

  useEffect(() => {
    const next = {};
    for (const key of Object.keys(inputs)) {
      if (props.options[key] !== undefined) next[key] = props.options[key];
    }
    setInputs(next);
    setInitial(structuredClone(next));
    refForm.current?.setValues(next);
  }, [props.options]);

  const save = async () => {
    const updates = compareObjects(inputs, initial);
    if (!updates.length) return showWarning(t('你似乎并没有修改什么'));
    setLoading(true);
    try {
      const responses = await Promise.all(updates.map(({ key }) => API.put('/api/option/', { key, value: String(inputs[key]) })));
      const failed = responses.find((res) => !res?.data?.success);
      if (failed) return showError(failed.data.message);
      showSuccess(t('保存成功'));
      props.refresh();
    } catch {
      showError(t('保存失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  const disabled = !inputs['quota_query_setting.enabled'];
  return (
    <Spin spinning={loading}>
      <Form values={inputs} getFormApi={(api) => (refForm.current = api)}>
        <Form.Section text='付费额度查询'>
          <Typography.Text type='tertiary'>用户可按用户名或用户 ID 精确查询当前余额；查询费全部进入低保池。</Typography.Text>
          <Row gutter={16} className='mt-4'>
            <Col xs={24} sm={12} md={8}><Form.Switch field='quota_query_setting.enabled' label='启用付费额度查询' onChange={change('quota_query_setting.enabled')} /></Col>
            <Col xs={24} sm={12} md={8}><Form.Switch field='quota_query_setting.show_entry' label='显示侧边栏入口' disabled={disabled} onChange={change('quota_query_setting.show_entry')} /></Col>
            <Col xs={24} sm={12} md={8}><Form.Switch field='quota_query_setting.allow_admin_and_root' label='允许查询管理员和 ID 1' disabled={disabled} onChange={change('quota_query_setting.allow_admin_and_root')} /></Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Slot label='单次查询费用'>
                <InputNumber style={{ width: '100%' }} min={0} prefix={currency.type === 'TOKENS' ? '' : currency.symbol} value={quotaToDisplayAmount(inputs['quota_query_setting.fee'])} disabled={disabled} onChange={(value) => change('quota_query_setting.fee')(displayAmountToQuota(value))} />
              </Form.Slot>
            </Col>
            <Col xs={24} sm={12} md={8}><Form.InputNumber field='quota_query_setting.daily_limit' label='每日查询次数' extraText='0 表示不限次数' min={0} disabled={disabled} onChange={change('quota_query_setting.daily_limit')} /></Col>
          </Row>
        </Form.Section>
      </Form>
      <Button onClick={save}>保存额度查询设置</Button>
    </Spin>
  );
}
