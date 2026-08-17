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
import { Button, Col, Form, Row, Select, Spin } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  parseHttpStatusCodeRules,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';
import HttpStatusCodeRulesInput from '../../../components/settings/HttpStatusCodeRulesInput';

const DEFAULT_INPUTS = {
  ChannelDisableThreshold: '',
  QuotaRemindThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  UserAgentBanEnabled: false,
  UserAgentBanKeywords: 'tavo',
  UserAgentGroupBlacklist: '',
  UserAgentGroupWhitelist: '',
  UserAgentGroupBanThreshold: '5',
  UserAgentGroupExemptUserIds: '',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
};

export default function SettingsMonitoring(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({ ...DEFAULT_INPUTS });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);
  const [userOptions, setUserOptions] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const userSearchTimer = useRef();
  const parsedAutoDisableStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticDisableStatusCodes || '',
  );
  const parsedAutoRetryStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticRetryStatusCodes || '',
  );

  const searchUsers = (keyword) => {
    clearTimeout(userSearchTimer.current);
    if (!keyword.trim()) return;
    userSearchTimer.current = setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const params = new URLSearchParams({ keyword: keyword.trim(), p: '1', page_size: '20' });
        const res = await API.get(`/api/user/search?${params.toString()}`);
        if (!res.data?.success) return showError(res.data?.message);
        setUserOptions((current) => {
          const selected = new Set(
            String(inputs.UserAgentGroupExemptUserIds || '')
              .split(',')
              .filter(Boolean),
          );
          const found = (res.data.data?.items || []).map((user) => ({
            value: String(user.id),
            label: `${user.display_name || user.username}（${user.username}，ID ${user.id}${user.discord_id ? `，DC ${user.discord_id}` : ''}）`,
          }));
          return [...current.filter((option) => selected.has(option.value)), ...found.filter((option) => !selected.has(option.value))];
        });
      } finally {
        setSearchingUsers(false);
      }
    }, 300);
  };

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    if (!parsedAutoDisableStatusCodes.ok) {
      const details =
        parsedAutoDisableStatusCodes.invalidTokens &&
        parsedAutoDisableStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoDisableStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动禁用状态码格式不正确')}${details}`);
    }
    if (!parsedAutoRetryStatusCodes.ok) {
      const details =
        parsedAutoRetryStatusCodes.invalidTokens &&
        parsedAutoRetryStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoRetryStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动重试状态码格式不正确')}${details}`);
    }
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        const normalizedMap = {
          AutomaticDisableStatusCodes: parsedAutoDisableStatusCodes.normalized,
          AutomaticRetryStatusCodes: parsedAutoRetryStatusCodes.normalized,
        };
        value = normalizedMap[item.key] ?? inputs[item.key];
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

  useEffect(() => {
    // 以 DEFAULT_INPUTS 为基底，确保所有字段始终存在（含新增的 UA 相关项），
    // 避免父组件首次以缺少这些键的默认对象渲染时把字段丢失，导致后续无法回显/保存。
    const currentInputs = { ...DEFAULT_INPUTS };
    for (let key in DEFAULT_INPUTS) {
      if (props.options[key] !== undefined) {
        if (typeof DEFAULT_INPUTS[key] === 'boolean') {
          currentInputs[key] =
            props.options[key] === 'true' || props.options[key] === true;
        } else {
          currentInputs[key] = props.options[key];
        }
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    const selectedIds = String(currentInputs.UserAgentGroupExemptUserIds || '')
      .split(',')
      .filter(Boolean);
    setUserOptions(selectedIds.map((id) => ({ value: id, label: `用户 ID ${id}` })));
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
          <Form.Section text={t('监控设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'monitor_setting.auto_test_channel_enabled'}
                  label={t('定时测试所有通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_enabled': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('自动测试所有通道间隔时间')}
                  step={1}
                  min={1}
                  suffix={t('分钟')}
                  extraText={t('每隔多少分钟测试一次所有通道')}
                  placeholder={''}
                  field={'monitor_setting.auto_test_channel_minutes'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_minutes':
                        parseInt(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('测试所有渠道的最长响应时间')}
                  step={1}
                  min={0}
                  suffix={t('秒')}
                  extraText={t(
                    '当运行通道全部测试时，超过此时间将自动禁用通道',
                  )}
                  placeholder={''}
                  field={'ChannelDisableThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      ChannelDisableThreshold: String(value),
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('额度提醒阈值')}
                  step={1}
                  min={0}
                  suffix={'Token'}
                  extraText={t('低于此额度时将发送邮件提醒用户')}
                  placeholder={''}
                  field={'QuotaRemindThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      QuotaRemindThreshold: String(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticDisableChannelEnabled'}
                  label={t('失败时自动禁用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      AutomaticDisableChannelEnabled: value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticEnableChannelEnabled'}
                  label={t('成功时自动启用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      AutomaticEnableChannelEnabled: value,
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <HttpStatusCodeRulesInput
                  label={t('自动禁用状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔',
                  )}
                  field={'AutomaticDisableStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableStatusCodes: value })
                  }
                  parsed={parsedAutoDisableStatusCodes}
                  invalidText={t('自动禁用状态码格式不正确')}
                />
                <HttpStatusCodeRulesInput
                  label={t('自动重试状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔；504 和 524 始终不重试，不受此处配置影响',
                  )}
                  field={'AutomaticRetryStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticRetryStatusCodes: value })
                  }
                  parsed={parsedAutoRetryStatusCodes}
                  invalidText={t('自动重试状态码格式不正确')}
                />
                <Form.TextArea
                  label={t('自动禁用关键词')}
                  placeholder={t('一行一个，不区分大小写')}
                  extraText={t(
                    '当上游通道返回错误中包含这些关键词时（不区分大小写），自动禁用通道',
                  )}
                  field={'AutomaticDisableKeywords'}
                  autosize={{ minRows: 6, maxRows: 12 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableKeywords: value })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'UserAgentBanEnabled'}
                  label={t('自动封禁违规 User-Agent')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  extraText={t(
                    '开启后，请求客户端 User-Agent 命中下方关键词时，自动封禁该用户并公开上榜',
                  )}
                  onChange={(value) =>
                    setInputs({ ...inputs, UserAgentBanEnabled: value })
                  }
                />
              </Col>
              <Col xs={24} sm={16}>
                <Form.TextArea
                  label={t('封禁 User-Agent 关键词')}
                  placeholder={t('一行一个，不区分大小写，子串包含即命中')}
                  extraText={t(
                    '例如填写 tavo，则任何 User-Agent 中包含 tavo 的请求都会被封禁并上榜',
                  )}
                  field={'UserAgentBanKeywords'}
                  autosize={{ minRows: 3, maxRows: 8 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, UserAgentBanKeywords: value })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('分组 UA 违规封禁阈值')}
                  step={1}
                  min={1}
                  suffix={t('次')}
                  extraText={t(
                    '同一用户在某分组累计违反黑/白名单达到此次数后自动封禁（不上榜），并通知管理员',
                  )}
                  field={'UserAgentGroupBanThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      UserAgentGroupBanThreshold: String(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.TextArea
                  label={t('分组 UA 黑名单')}
                  placeholder={'default:badua1,badua2\ncoding:otherbad'}
                  extraText={t(
                    '每行一个分组，格式 group:ua1,ua2；该分组请求 UA 命中任一关键词即算违规（子串包含）',
                  )}
                  field={'UserAgentGroupBlacklist'}
                  autosize={{ minRows: 4, maxRows: 10 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, UserAgentGroupBlacklist: value })
                  }
                />
              </Col>
              <Col xs={24} sm={12}>
                <Form.TextArea
                  label={t('分组 UA 白名单')}
                  placeholder={'default:node-fetch,TauriTavern\ncoding:claudecode'}
                  extraText={t(
                    '每行一个分组，格式 group:ua1,ua2；该分组只允许 UA 命中列表内的请求，其余算违规',
                  )}
                  field={'UserAgentGroupWhitelist'}
                  autosize={{ minRows: 4, maxRows: 10 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, UserAgentGroupWhitelist: value })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={24}>
                <Select
                  multiple
                  filter
                  remote
                  loading={searchingUsers}
                  optionList={userOptions}
                  value={String(inputs.UserAgentGroupExemptUserIds || '').split(',').filter(Boolean)}
                  onSearch={searchUsers}
                  onChange={(values) =>
                    setInputs({
                      ...inputs,
                      UserAgentGroupExemptUserIds: values.join(','),
                    })
                  }
                  placeholder={t('搜索用户 ID、用户名、显示名称、邮箱或 Discord ID')}
                  style={{ width: '100%', marginBottom: 16 }}
                  maxTagCount={6}
                />
                <div className='text-sm text-semi-color-text-2 mb-4'>
                  {t('分组 UA 策略豁免用户：仅绕过分组 UA 黑白名单，仍受全局违规 UA 关键词（如 tavo）和令牌自身 UA 限制约束')}
                </div>
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存监控设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
