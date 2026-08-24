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
  Banner,
  Button,
  Col,
  Form,
  Row,
  Spin,
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

  // 只读统计值：因 524 重试而额外消耗的上游调用次数（后端计数器持久化）
  const retryCount = props.options?.RetryOn524Count ?? '0';

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
                  '依赖“监控设置-失败重试次数”，建议设为 2-3 次；多 Key 渠道每次重试会自动更换 Key',
                )}
                onChange={handleFieldChange('RetryOn524Enabled')}
              />
            </Col>
            <Col xs={24} sm={12} md={8} lg={8} xl={8}>
              <Form.Slot label={t('额外消耗次数统计')}>
                <div style={{ marginTop: 4 }}>
                  <Tag color='orange' size='large'>
                    {t('因 524 重试累计额外调用')}：{retryCount} {t('次')}
                  </Tag>
                </div>
                <Text
                  type='tertiary'
                  size='small'
                  style={{ marginTop: 6, display: 'block' }}
                >
                  {t(
                    '该计数为进程累计值并持久化保存，用于评估额度供给。可在数据库 options 表中将 RetryOn524Count 置 0 以重置统计。',
                  )}
                </Text>
              </Form.Slot>
            </Col>
          </Row>
          <Row>
            <Button size='default' onClick={onSubmit}>
              {t('保存')}
            </Button>
          </Row>
        </Form.Section>
      </Form>
    </Spin>
  );
}
