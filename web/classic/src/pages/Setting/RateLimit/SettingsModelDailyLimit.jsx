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
import { Button, Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  verifyJSON,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

export default function ModelDailyLimit(props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    ModelDailyLimitEnabled: false,
    ModelDailyLimit: '',
    ModelDailyLimitGroups: '',
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

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

        for (let i = 0; i < res.length; i++) {
          if (!res[i].data.success) {
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
          <Form.Section text={t('模型每日调用次数限制')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'ModelDailyLimitEnabled'}
                  label={t('启用模型每日调用次数限制')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      ModelDailyLimitEnabled: value,
                    });
                  }}
                />
              </Col>
            </Row>
            <Row>
              <Col xs={24} sm={16}>
                <Form.TextArea
                  label={t('每日调用上限配置')}
                  placeholder={t(
                    '{\n  "gpt-4o": {\n    "default": 300\n  }\n}',
                  )}
                  field={'ModelDailyLimit'}
                  autosize={{ minRows: 6, maxRows: 18 }}
                  trigger='blur'
                  stopValidateWithError
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
                            '使用 JSON 对象格式，格式为：{"模型名": {"分组名": 每日最大成功调用次数}}',
                          )}
                        </li>
                        <li>
                          {t(
                            '示例：{"gpt-4o": {"default": 300}} 表示 default 分组内所有用户对 gpt-4o 每天合计最多成功调用 300 次。',
                          )}
                        </li>
                        <li>{t('每日次数按自然日零点（服务器时区）重置。')}</li>
                        <li>{t('仅统计成功的调用，失败请求不计入。')}</li>
                        <li>{t('每日上限必须为大于等于 1 的整数。')}</li>
                        <li>{t('同一分组内所有用户共享该模型的每日额度。')}</li>
                      </ul>
                    </div>
                  }
                  onChange={(value) => {
                    setInputs({ ...inputs, ModelDailyLimit: value });
                  }}
                />
              </Col>
            </Row>
            <Row>
              <Col xs={24} sm={16}>
                <Form.TextArea
                  label={t('共享限额组配置（可选）')}
                  placeholder={
                    '[\n  {\n    "name": "channel_a",\n    "models": ["gpt-4o", "gpt-4o-mini"],\n    "limits": { "default": 500 }\n  }\n]'
                  }
                  field={'ModelDailyLimitGroups'}
                  autosize={{ minRows: 6, maxRows: 18 }}
                  trigger='blur'
                  stopValidateWithError
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
                            '用于让来自同一渠道的多个模型共用一份每日额度。数组格式，每个组包含 name（组名，需唯一）、models（模型名列表）、limits（分组名到上限的映射）。',
                          )}
                        </li>
                        <li>
                          {t(
                            '示例：[{"name": "channel_a", "models": ["gpt-4o", "gpt-4o-mini"], "limits": {"default": 500}}] 表示 default 分组内这两个模型每天合计最多成功调用 500 次。',
                          )}
                        </li>
                        <li>
                          {t(
                            '共享组优先于上方单模型配置：若某模型同时命中两者，只按共享组计数。',
                          )}
                        </li>
                        <li>{t('其余规则（自然日重置、仅计成功调用、分组内所有用户共享）与上方一致。')}</li>
                      </ul>
                    </div>
                  }
                  onChange={(value) => {
                    setInputs({ ...inputs, ModelDailyLimitGroups: value });
                  }}
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存每日调用限制')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
