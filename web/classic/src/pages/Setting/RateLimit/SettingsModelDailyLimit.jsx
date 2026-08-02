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

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Button,
  Col,
  Form,
  Row,
  Spin,
  Collapse,
  Typography,
  Table,
  Select,
  InputNumber,
  Empty,
  Card,
  Input,
} from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  verifyJSON,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

// 将 {model:{group:limit}} 的 JSON 字符串解析为行数组 [{model,group,limit}]
function limitJSONToRows(jsonStr) {
  if (!jsonStr) return [];
  try {
    const obj = JSON.parse(jsonStr);
    const rows = [];
    Object.keys(obj || {}).forEach((model) => {
      const groups = obj[model] || {};
      Object.keys(groups).forEach((group) => {
        rows.push({ model, group, limit: groups[group] });
      });
    });
    return rows;
  } catch {
    return [];
  }
}

// 行数组转回 {model:{group:limit}} JSON 字符串；忽略不完整行
function rowsToLimitJSON(rows) {
  const obj = {};
  (rows || []).forEach(({ model, group, limit }) => {
    if (!model || !group) return;
    const n = parseInt(limit, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (!obj[model]) obj[model] = {};
    obj[model][group] = n;
  });
  return JSON.stringify(obj, null, 2);
}

// 共享限额组 JSON -> 卡片数组。每组：{name, models:[], limits:[{group,limit}]}
function groupsJSONToCards(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    return arr.map((g) => ({
      name: g?.name || '',
      models: Array.isArray(g?.models) ? g.models : [],
      limits: Object.keys(g?.limits || {}).map((group) => ({
        group,
        limit: g.limits[group],
      })),
    }));
  } catch {
    return [];
  }
}

// 卡片数组 -> 共享限额组 JSON 字符串；忽略不完整项
function cardsToGroupsJSON(cards) {
  const arr = [];
  (cards || []).forEach(({ name, models, limits }) => {
    if (!name) return;
    const validModels = (models || []).filter(Boolean);
    const limitObj = {};
    (limits || []).forEach(({ group, limit }) => {
      if (!group) return;
      const n = parseInt(limit, 10);
      if (!Number.isFinite(n) || n < 1) return;
      limitObj[group] = n;
    });
    if (validModels.length === 0 && Object.keys(limitObj).length === 0) return;
    arr.push({ name, models: validModels, limits: limitObj });
  });
  return JSON.stringify(arr, null, 2);
}

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

  // 行编辑器数据
  const [limitRows, setLimitRows] = useState([]);
  // 共享限额组卡片数据
  const [groupCards, setGroupCards] = useState([]);
  // 下拉数据：模型选项（带渠道名）、分组选项
  const [modelOptions, setModelOptions] = useState([]);
  const [groupOptions, setGroupOptions] = useState([]);

  // 加载模型（含渠道名）与分组，用于下拉
  useEffect(() => {
    (async () => {
      try {
        const [mRes, gRes] = await Promise.all([
          API.get('/api/channel/models_with_channels'),
          API.get('/api/group/'),
        ]);
        if (mRes?.data?.success) {
          const opts = (mRes.data.data || []).map((it) => {
            const channels = it.channels || [];
            const suffix = channels.length
              ? `（${channels.join(', ')}）`
              : '';
            return {
              value: it.model,
              label: `${it.model}${suffix}`,
              // 用于搜索匹配：模型名 + 渠道名
              filterText: `${it.model} ${channels.join(' ')}`,
            };
          });
          setModelOptions(opts);
        }
        if (gRes?.data?.success) {
          setGroupOptions(
            (gRes.data.data || []).map((g) => ({ value: g, label: g })),
          );
        }
      } catch (e) {
        // 下拉数据获取失败不阻塞页面，用户仍可用高级模式手填
      }
    })();
  }, []);

  // 当 JSON 文本变化（外部加载或高级模式编辑）时同步到行编辑器
  const syncRowsFromJSON = (jsonStr) => {
    setLimitRows(limitJSONToRows(jsonStr));
  };

  // 行编辑器变更后回写 JSON
  const applyRowsToInputs = (rows) => {
    setLimitRows(rows);
    const json = rowsToLimitJSON(rows);
    setInputs((prev) => ({ ...prev, ModelDailyLimit: json }));
    refForm.current?.setValue('ModelDailyLimit', json);
  };

  const addRow = () => {
    applyRowsToInputs([...limitRows, { model: '', group: 'default', limit: 100 }]);
  };
  const removeRow = (idx) => {
    const next = limitRows.slice();
    next.splice(idx, 1);
    applyRowsToInputs(next);
  };
  const updateRow = (idx, key, value) => {
    const next = limitRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    applyRowsToInputs(next);
  };

  // ---- 共享限额组卡片同步 ----
  const syncCardsFromJSON = (jsonStr) => {
    setGroupCards(groupsJSONToCards(jsonStr));
  };
  const applyCardsToInputs = (cards) => {
    setGroupCards(cards);
    const json = cardsToGroupsJSON(cards);
    setInputs((prev) => ({ ...prev, ModelDailyLimitGroups: json }));
    refForm.current?.setValue('ModelDailyLimitGroups', json);
  };
  const addCard = () => {
    applyCardsToInputs([
      ...groupCards,
      { name: '', models: [], limits: [{ group: 'default', limit: 500 }] },
    ]);
  };
  const removeCard = (idx) => {
    const next = groupCards.slice();
    next.splice(idx, 1);
    applyCardsToInputs(next);
  };
  const updateCard = (idx, key, value) => {
    const next = groupCards.slice();
    next[idx] = { ...next[idx], [key]: value };
    applyCardsToInputs(next);
  };
  const addCardLimit = (cardIdx) => {
    const next = groupCards.slice();
    const limits = (next[cardIdx].limits || []).slice();
    limits.push({ group: 'default', limit: 500 });
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };
  const updateCardLimit = (cardIdx, limitIdx, key, value) => {
    const next = groupCards.slice();
    const limits = (next[cardIdx].limits || []).slice();
    limits[limitIdx] = { ...limits[limitIdx], [key]: value };
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };
  const removeCardLimit = (cardIdx, limitIdx) => {
    const next = groupCards.slice();
    const limits = (next[cardIdx].limits || []).slice();
    limits.splice(limitIdx, 1);
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };

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
    syncRowsFromJSON(currentInputs.ModelDailyLimit);
    syncCardsFromJSON(currentInputs.ModelDailyLimitGroups);
  }, [props.options]);

  // 模型下拉的自定义搜索：按模型名或渠道名匹配
  const modelFilter = (input, option) => {
    if (!input) return true;
    const kw = input.toLowerCase();
    return (option.filterText || option.value || '')
      .toLowerCase()
      .includes(kw);
  };

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
                    setInputs({ ...inputs, ModelDailyLimitEnabled: value });
                  }}
                />
              </Col>
            </Row>

            {/* 行编辑器：每行一个 模型/分组/上限 */}
            <Form.Slot label={t('每日调用上限配置')}>
              <div style={{ marginBottom: 8 }}>
                <Text type='tertiary'>
                  {t(
                    '每行为一条限额：选择模型（下拉含所属渠道名）、分组，并填写每日最大成功调用次数。',
                  )}
                </Text>
              </div>
              <Table
                size='small'
                pagination={false}
                dataSource={limitRows}
                empty={<Empty description={t('暂无限额，点击下方按钮添加')} />}
                columns={[
                  {
                    title: t('模型'),
                    dataIndex: 'model',
                    width: '45%',
                    render: (val, record, idx) => (
                      <Select
                        filter={modelFilter}
                        style={{ width: '100%' }}
                        placeholder={t('搜索模型名或渠道名')}
                        optionList={modelOptions}
                        value={val || undefined}
                        allowCreate
                        onChange={(v) => updateRow(idx, 'model', v)}
                      />
                    ),
                  },
                  {
                    title: t('分组'),
                    dataIndex: 'group',
                    width: '25%',
                    render: (val, record, idx) => (
                      <Select
                        filter
                        style={{ width: '100%' }}
                        placeholder={t('分组')}
                        optionList={groupOptions}
                        value={val || undefined}
                        allowCreate
                        onChange={(v) => updateRow(idx, 'group', v)}
                      />
                    ),
                  },
                  {
                    title: t('每日上限'),
                    dataIndex: 'limit',
                    width: '20%',
                    render: (val, record, idx) => (
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        step={1}
                        value={val}
                        onChange={(v) => updateRow(idx, 'limit', v)}
                      />
                    ),
                  },
                  {
                    title: '',
                    dataIndex: 'op',
                    width: '10%',
                    render: (val, record, idx) => (
                      <Button
                        theme='borderless'
                        type='danger'
                        icon={<IconDelete />}
                        onClick={() => removeRow(idx)}
                      />
                    ),
                  },
                ]}
              />
              <Button
                style={{ marginTop: 8 }}
                icon={<IconPlus />}
                onClick={addRow}
              >
                {t('添加一行')}
              </Button>
            </Form.Slot>

            {/* 高级模式：直接编辑 JSON，与行编辑器双向同步 */}
            <Collapse style={{ marginTop: 12 }}>
              <Collapse.Panel
                header={t('高级模式（直接编辑 JSON）')}
                itemKey='json'
              >
                <Row>
                  <Col xs={24} sm={16}>
                    <Form.TextArea
                      noLabel
                      field={'ModelDailyLimit'}
                      autosize={{ minRows: 6, maxRows: 18 }}
                      trigger='blur'
                      stopValidateWithError
                      rules={[
                        {
                          validator: (rule, value) =>
                            !value || verifyJSON(value),
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
                            <li>{t('编辑此处后失焦，会自动同步到上方表格。')}</li>
                            <li>{t('每日次数按自然日零点（服务器时区）重置。')}</li>
                            <li>{t('仅统计成功的调用，失败请求不计入。')}</li>
                            <li>{t('每日上限必须为大于等于 1 的整数。')}</li>
                            <li>{t('同一分组内所有用户共享该模型的每日额度。')}</li>
                          </ul>
                        </div>
                      }
                      onChange={(value) => {
                        setInputs({ ...inputs, ModelDailyLimit: value });
                        syncRowsFromJSON(value);
                      }}
                    />
                  </Col>
                </Row>
              </Collapse.Panel>
            </Collapse>

            <Row style={{ marginTop: 12 }}>
              <Col xs={24} sm={20}>
                <Form.Slot label={t('共享限额组配置（可选）')}>
                  <div style={{ marginBottom: 8 }}>
                    <Text type='tertiary'>
                      {t(
                        '让同一渠道的多个模型共用一份每日额度。每个组：填组名、多选模型（下拉含渠道名）、设置各分组的每日上限。共享组优先于上方单模型配置。',
                      )}
                    </Text>
                  </div>
                  {groupCards.length === 0 && (
                    <Empty
                      description={t('暂无共享限额组，点击下方按钮添加')}
                      style={{ padding: '12px 0' }}
                    />
                  )}
                  {groupCards.map((card, cardIdx) => (
                    <Card
                      key={cardIdx}
                      style={{ marginBottom: 12 }}
                      bodyStyle={{ padding: 16 }}
                      title={
                        <Input
                          prefix={t('组名')}
                          placeholder={t('唯一组名，如 channel_a')}
                          value={card.name}
                          style={{ maxWidth: 320 }}
                          onChange={(v) => updateCard(cardIdx, 'name', v)}
                        />
                      }
                      headerExtraContent={
                        <Button
                          theme='borderless'
                          type='danger'
                          icon={<IconDelete />}
                          onClick={() => removeCard(cardIdx)}
                        >
                          {t('删除组')}
                        </Button>
                      }
                    >
                      <div style={{ marginBottom: 12 }}>
                        <Text type='tertiary' size='small'>
                          {t('模型（可多选）')}
                        </Text>
                        <Select
                          multiple
                          filter={modelFilter}
                          style={{ width: '100%', marginTop: 4 }}
                          placeholder={t('搜索模型名或渠道名，可多选')}
                          optionList={modelOptions}
                          value={card.models}
                          allowCreate
                          onChange={(v) => updateCard(cardIdx, 'models', v)}
                        />
                      </div>
                      <div>
                        <Text type='tertiary' size='small'>
                          {t('各分组每日上限')}
                        </Text>
                        {(card.limits || []).map((lim, limIdx) => (
                          <div
                            key={limIdx}
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              marginTop: 6,
                            }}
                          >
                            <Select
                              filter
                              style={{ width: 220 }}
                              placeholder={t('分组')}
                              optionList={groupOptions}
                              value={lim.group || undefined}
                              allowCreate
                              onChange={(v) =>
                                updateCardLimit(cardIdx, limIdx, 'group', v)
                              }
                            />
                            <InputNumber
                              style={{ width: 200 }}
                              min={1}
                              step={1}
                              value={lim.limit}
                              onChange={(v) =>
                                updateCardLimit(cardIdx, limIdx, 'limit', v)
                              }
                            />
                            <Button
                              theme='borderless'
                              type='danger'
                              icon={<IconDelete />}
                              onClick={() => removeCardLimit(cardIdx, limIdx)}
                            />
                          </div>
                        ))}
                        <Button
                          size='small'
                          style={{ marginTop: 8 }}
                          icon={<IconPlus />}
                          onClick={() => addCardLimit(cardIdx)}
                        >
                          {t('添加分组上限')}
                        </Button>
                      </div>
                    </Card>
                  ))}
                  <Button icon={<IconPlus />} onClick={addCard}>
                    {t('添加共享限额组')}
                  </Button>
                </Form.Slot>
              </Col>
            </Row>

            {/* 共享组高级模式：直接编辑 JSON */}
            <Collapse style={{ marginTop: 12 }}>
              <Collapse.Panel
                header={t('共享限额组高级模式（直接编辑 JSON）')}
                itemKey='groups_json'
              >
                <Row>
                  <Col xs={24} sm={16}>
                    <Form.TextArea
                      noLabel
                      placeholder={
                        '[\n  {\n    "name": "channel_a",\n    "models": ["gpt-4o", "gpt-4o-mini"],\n    "limits": { "default": 500 }\n  }\n]'
                      }
                      field={'ModelDailyLimitGroups'}
                      autosize={{ minRows: 6, maxRows: 18 }}
                      trigger='blur'
                      stopValidateWithError
                      rules={[
                        {
                          validator: (rule, value) =>
                            !value || verifyJSON(value),
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
                            <li>{t('编辑此处后失焦，会自动同步到上方卡片。')}</li>
                            <li>
                              {t(
                                '共享组优先于上方单模型配置：若某模型同时命中两者，只按共享组计数。',
                              )}
                            </li>
                            <li>
                              {t(
                                '其余规则（自然日重置、仅计成功调用、分组内所有用户共享）与上方一致。',
                              )}
                            </li>
                          </ul>
                        </div>
                      }
                      onChange={(value) => {
                        setInputs({ ...inputs, ModelDailyLimitGroups: value });
                        syncCardsFromJSON(value);
                      }}
                    />
                  </Col>
                </Row>
              </Collapse.Panel>
            </Collapse>
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
