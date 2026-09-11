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

// 将 {model:{group:limit}} 的 JSON 字符串解析为行数组 [{model,group,limit,slots}]

function limitJSONToRows(jsonStr, resetHoursJson, tiersJson, slotsJson) {
  if (!jsonStr && !slotsJson) return [];
  try {
    const obj = jsonStr ? JSON.parse(jsonStr) : {};
    const resetHours = resetHoursJson ? JSON.parse(resetHoursJson) : {};
    const tiers = tiersJson ? JSON.parse(tiersJson) : {};
    const slots = slotsJson ? JSON.parse(slotsJson) : {};
    const rows = [];
    const seen = new Set();
    Object.keys(slots || {}).forEach((model) => {
      const groups = slots[model] || {};
      Object.keys(groups).forEach((group) => {
        if (!Array.isArray(groups[group]) || groups[group].length === 0)
          return;
        rows.push({
          model,
          group,
          limit: 0,
          resetHour: resetHours[model] ?? 0,
          tiers: tiers?.[model]?.[group] || [],
          useSlots: true,
          slots: groups[group],
        });
        seen.add(`${model}|${group}`);
      });
    });
    Object.keys(obj || {}).forEach((model) => {
      const groups = obj[model] || {};
      Object.keys(groups).forEach((group) => {
        if (seen.has(`${model}|${group}`)) return;
        rows.push({
          model,
          group,
          limit: groups[group],
          resetHour: resetHours[model] ?? 0,
          tiers: tiers?.[model]?.[group] || [],
          useSlots: false,
          slots: [],
        });
      });
    });
    return rows;
  } catch {
    return [];
  }
}

// 行数组转回 {model:{group:limit}} JSON 字符串；忽略不完整行；分时段行不写入整日配置
function rowsToLimitJSON(rows) {
  const obj = {};
  (rows || []).forEach(({ model, group, limit, useSlots }) => {
    if (!model || !group) return;
    if (useSlots) return;
    const n = parseInt(limit, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (!obj[model]) obj[model] = {};
    obj[model][group] = n;
  });
  return JSON.stringify(obj, null, 2);
}

// 行数组转分时段配置 JSON：{model:{group:[{start,end,limit}]}}
function rowsToTimeSlotsJSON(rows) {
  const obj = {};
  (rows || []).forEach(({ model, group, useSlots, slots }) => {
    if (!model || !group || !useSlots) return;
    const valid = (slots || [])
      .map(({ start, end, limit }) => ({
        start: parseInt(start, 10),
        end: parseInt(end, 10),
        limit: parseInt(limit, 10),
      }))
      .filter(
        ({ start, end, limit }) =>
          Number.isInteger(start) &&
          Number.isInteger(end) &&
          Number.isInteger(limit) &&
          start >= 0 &&
          start <= 23 &&
          end >= 0 &&
          end <= 24 &&
          limit >= 0,
      );
    if (valid.length === 0) return;
    if (!obj[model]) obj[model] = {};
    obj[model][group] = valid;
  });
  return JSON.stringify(obj, null, 2);
}

function rowsToTiersJSON(rows) {
  const obj = {};
  (rows || []).forEach(({ model, group, tiers }) => {
    if (!model || !group || !Array.isArray(tiers)) return;
    if (!obj[model]) obj[model] = {};
    obj[model][group] = tiers;
  });
  return JSON.stringify(obj, null, 2);
}

function rowsToResetHoursJSON(rows) {
  const obj = {};
  (rows || []).forEach(({ model, resetHour }) => {
    if (!model) return;
    const hour = parseInt(resetHour, 10);
    obj[model] = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
  });
  return JSON.stringify(obj, null, 2);
}

// 共享限额组 JSON -> 卡片数组。每组：{name, models:[], limits:[{group,limit,timeSlots}]}
function groupsJSONToCards(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    return arr.map((g) => ({
      name: g?.name || '',
      models: Array.isArray(g?.models) ? g.models : [],
      resetHour: g?.reset_hour ?? 0,
      limits: Object.keys(g?.limits || {}).map((group) => ({
        group,
        limit: g.limits[group],
        tiers: g?.tiers?.[group] || [],
        useSlots: false,
        slots: [],
      })),
      timeSlots: Object.keys(g?.time_slots || {}).map((group) => ({
        group,
        slots: g.time_slots[group] || [],
      })),
    }));
  } catch {
    return [];
  }
}

// 卡片数组 -> 共享限额组 JSON 字符串；忽略不完整项
function cardsToGroupsJSON(cards) {
  const arr = [];
  (cards || []).forEach(({ name, models, limits, timeSlots, resetHour }) => {
    if (!name) return;
    const validModels = (models || []).filter(Boolean);
    const limitObj = {};
    const tierObj = {};
    (limits || []).forEach(({ group, limit, tiers, useSlots }) => {
      if (!group || useSlots) return;
      const n = parseInt(limit, 10);
      if (!Number.isFinite(n) || n < 1) return;
      limitObj[group] = n;
      if (Array.isArray(tiers)) tierObj[group] = tiers;
    });
    const slotObj = {};
    (timeSlots || []).forEach(({ group, slots }) => {
      if (!group) return;
      const valid = (slots || [])
        .map(({ start, end, limit }) => ({
          start: parseInt(start, 10),
          end: parseInt(end, 10),
          limit: parseInt(limit, 10),
        }))
        .filter(
          ({ start, end, limit }) =>
            Number.isInteger(start) &&
            Number.isInteger(end) &&
            Number.isInteger(limit) &&
            start >= 0 &&
            start <= 23 &&
            end >= 0 &&
            end <= 24 &&
            limit >= 0,
        );
      if (valid.length > 0) slotObj[group] = valid;
    });
    if (
      validModels.length === 0 &&
      Object.keys(limitObj).length === 0 &&
      Object.keys(slotObj).length === 0
    )
      return;
    const hour = parseInt(resetHour, 10);
    const item = {
      name,
      models: validModels,
      limits: limitObj,
      tiers: tierObj,
      reset_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
    };
    if (Object.keys(slotObj).length > 0) item.time_slots = slotObj;
    arr.push(item);
  });
  return JSON.stringify(arr, null, 2);
}

export default function ModelDailyLimit(props) {
  const { t } = useTranslation();
  const resetHourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: `${String(hour).padStart(2, '0')}:00${hour === 0 ? '' : `（${t('非标准刷新')}）`}`,
  }));

  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    ModelDailyLimitEnabled: false,
    ModelDailyLimit: '',
    ModelDailyLimitTiers: '',
    ModelDailyLimitResetHours: '',
    ModelDailyLimitGroups: '',
    ModelTimeSlotLimits: '',
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
            const suffix = channels.length ? `（${channels.join(', ')}）` : '';
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
  const syncRowsFromJSON = (
    jsonStr,
    resetHoursJson = inputs.ModelDailyLimitResetHours,
    tiersJson = inputs.ModelDailyLimitTiers,
    slotsJson = inputs.ModelTimeSlotLimits,
  ) => {
    setLimitRows(
      limitJSONToRows(jsonStr, resetHoursJson, tiersJson, slotsJson),
    );
  };

  // 行编辑器变更后回写 JSON
  const applyRowsToInputs = (rows) => {
    setLimitRows(rows);
    const json = rowsToLimitJSON(rows);
    const tiersJson = rowsToTiersJSON(rows);
    const resetHoursJson = rowsToResetHoursJSON(rows);
    const slotsJson = rowsToTimeSlotsJSON(rows);
    setInputs((prev) => ({
      ...prev,
      ModelDailyLimit: json,
      ModelDailyLimitTiers: tiersJson,
      ModelDailyLimitResetHours: resetHoursJson,
      ModelTimeSlotLimits: slotsJson,
    }));
    refForm.current?.setValue('ModelDailyLimit', json);
    refForm.current?.setValue('ModelDailyLimitTiers', tiersJson);
    refForm.current?.setValue('ModelDailyLimitResetHours', resetHoursJson);
    refForm.current?.setValue('ModelTimeSlotLimits', slotsJson);
  };

  const addRow = () => {
    applyRowsToInputs([
      ...limitRows,
      {
        model: '',
        group: 'default',
        limit: 100,
        resetHour: 0,
        tiers: [],
        useSlots: false,
        slots: [],
      },
    ]);
  };
  const removeRow = (idx) => {
    const next = limitRows.slice();
    next.splice(idx, 1);
    applyRowsToInputs(next);
  };
  const updateRow = (idx, key, value) => {
    const next = limitRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    // 切换到分时段时初始化时段列表（经典三分段）；切回整日时清空
    if (key === 'useSlots') {
      if (value && (!next[idx].slots || next[idx].slots.length === 0)) {
        next[idx].slots = [
          { start: 0, end: 8, limit: 100 },
          { start: 8, end: 16, limit: 100 },
          { start: 16, end: 24, limit: 100 },
        ];
      }
      if (!value) {
        next[idx].slots = [];
      }
    }
    applyRowsToInputs(next);
  };
  const addRowTier = (idx) => {
    const next = limitRows.slice();
    const tiers = [...(next[idx].tiers || [])];
    const from = tiers.length ? Number(tiers[tiers.length - 1].to) + 1 : 1;
    tiers.push({ from, to: Number(next[idx].limit) || from, multiplier: 1 });
    next[idx] = { ...next[idx], tiers };
    applyRowsToInputs(next);
  };
  const updateRowTier = (rowIdx, tierIdx, key, value) => {
    const next = limitRows.slice();
    const tiers = [...(next[rowIdx].tiers || [])];
    tiers[tierIdx] = { ...tiers[tierIdx], [key]: value };
    next[rowIdx] = { ...next[rowIdx], tiers };
    applyRowsToInputs(next);
  };
  const removeRowTier = (rowIdx, tierIdx) => {
    const next = limitRows.slice();
    const tiers = [...(next[rowIdx].tiers || [])];
    tiers.splice(tierIdx, 1);
    next[rowIdx] = { ...next[rowIdx], tiers };
    applyRowsToInputs(next);
  };

  // ---- 分时段行编辑 ----
  // 起始时刻 0~23；结束时刻额外提供 24:00（存储时 24 归一化为 0，后端 End=0 视为 24）
  const hourOptions = Array.from({ length: 24 }, (_, h) => ({
    value: h,
    label: `${String(h).padStart(2, '0')}:00`,
  }));
  const endHourOptions = [
    ...hourOptions,
    { value: 24, label: '24:00' },
  ];
  // 存储用 end（0~24，24 归一化为 0）；显示用 end（0 转回 24，仅当 start>0）
  const slotEndToDisplay = (start, end) => {
    if (Number(end) === 0 && Number(start) > 0) return 24;
    return Number(end);
  };
  const slotEndToStore = (end) => (Number(end) >= 24 ? 0 : Number(end));
  const addRowSlot = (idx) => {
    const next = limitRows.slice();
    const slots = [...(next[idx].slots || [])];
    // 默认从上一个时段结束点开始，8 小时一段，上限 100
    const start = slots.length
      ? Number(slots[slots.length - 1].end) % 24
      : 0;
    const end = (start + 8) % 24;
    slots.push({ start, end, limit: 100 });
    next[idx] = { ...next[idx], useSlots: true, slots };
    applyRowsToInputs(next);
  };
  const updateRowSlot = (rowIdx, slotIdx, key, value) => {
    const next = limitRows.slice();
    const slots = [...(next[rowIdx].slots || [])];
    slots[slotIdx] = { ...slots[slotIdx], [key]: value };
    next[rowIdx] = { ...next[rowIdx], slots };
    applyRowsToInputs(next);
  };
  const removeRowSlot = (rowIdx, slotIdx) => {
    const next = limitRows.slice();
    const slots = [...(next[rowIdx].slots || [])];
    slots.splice(slotIdx, 1);
    next[rowIdx] = {
      ...next[rowIdx],
      slots,
      useSlots: slots.length > 0,
    };
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
      {
        name: '',
        models: [],
        limits: [{ group: 'default', limit: 500, tiers: [], useSlots: false, slots: [] }],
        timeSlots: [],
        resetHour: 0,
      },
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
    limits.push({ group: 'default', limit: 500, tiers: [], useSlots: false, slots: [] });
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
  const addCardTier = (cardIdx, limitIdx) => {
    const next = groupCards.slice();
    const limits = [...(next[cardIdx].limits || [])];
    const tiers = [...(limits[limitIdx].tiers || [])];
    const from = tiers.length ? Number(tiers[tiers.length - 1].to) + 1 : 1;
    tiers.push({
      from,
      to: Number(limits[limitIdx].limit) || from,
      multiplier: 1,
    });
    limits[limitIdx] = { ...limits[limitIdx], tiers };
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };
  const updateCardTier = (cardIdx, limitIdx, tierIdx, key, value) => {
    const next = groupCards.slice();
    const limits = [...(next[cardIdx].limits || [])];
    const tiers = [...(limits[limitIdx].tiers || [])];
    tiers[tierIdx] = { ...tiers[tierIdx], [key]: value };
    limits[limitIdx] = { ...limits[limitIdx], tiers };
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };
  const removeCardTier = (cardIdx, limitIdx, tierIdx) => {
    const next = groupCards.slice();
    const limits = [...(next[cardIdx].limits || [])];
    const tiers = [...(limits[limitIdx].tiers || [])];
    tiers.splice(tierIdx, 1);
    limits[limitIdx] = { ...limits[limitIdx], tiers };
    next[cardIdx] = { ...next[cardIdx], limits };
    applyCardsToInputs(next);
  };

  // ---- 卡片分时段编辑：每行一个分组 + 该分组的时段列表 ----
  const addCardTimeSlotRow = (cardIdx) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    timeSlots.push({ group: 'default', slots: [] });
    next[cardIdx] = { ...next[cardIdx], timeSlots };
    applyCardsToInputs(next);
  };
  const removeCardTimeSlotRow = (cardIdx, slotRowIdx) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    timeSlots.splice(slotRowIdx, 1);
    next[cardIdx] = { ...next[cardIdx], timeSlots };
    applyCardsToInputs(next);
  };
  const updateCardTimeSlotRow = (cardIdx, slotRowIdx, key, value) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    timeSlots[slotRowIdx] = { ...timeSlots[slotRowIdx], [key]: value };
    next[cardIdx] = { ...next[cardIdx], timeSlots };
    applyCardsToInputs(next);
  };
  const addCardSlot = (cardIdx, slotRowIdx) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    const slots = [...(timeSlots[slotRowIdx].slots || [])];
    const start = slots.length ? Number(slots[slots.length - 1].end) % 24 : 0;
    const end = (start + 8) % 24;
    slots.push({ start, end, limit: 100 });
    timeSlots[slotRowIdx] = { ...timeSlots[slotRowIdx], slots };
    next[cardIdx] = { ...next[cardIdx], timeSlots };
    applyCardsToInputs(next);
  };
  const updateCardSlot = (cardIdx, slotRowIdx, slotIdx, key, value) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    const slots = [...(timeSlots[slotRowIdx].slots || [])];
    slots[slotIdx] = { ...slots[slotIdx], [key]: value };
    timeSlots[slotRowIdx] = { ...timeSlots[slotRowIdx], slots };
    next[cardIdx] = { ...next[cardIdx], timeSlots };
    applyCardsToInputs(next);
  };
  const removeCardSlot = (cardIdx, slotRowIdx, slotIdx) => {
    const next = groupCards.slice();
    const timeSlots = [...(next[cardIdx].timeSlots || [])];
    const slots = [...(timeSlots[slotRowIdx].slots || [])];
    slots.splice(slotIdx, 1);
    timeSlots[slotRowIdx] = { ...timeSlots[slotRowIdx], slots };
    next[cardIdx] = { ...next[cardIdx], timeSlots };
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
    syncRowsFromJSON(
      currentInputs.ModelDailyLimit,
      currentInputs.ModelDailyLimitResetHours,
      currentInputs.ModelDailyLimitTiers,
      currentInputs.ModelTimeSlotLimits,
    );
    syncCardsFromJSON(currentInputs.ModelDailyLimitGroups);
  }, [props.options]);

  // 模型下拉的自定义搜索：按模型名或渠道名匹配
  const modelFilter = (input, option) => {
    if (!input) return true;
    const kw = input.toLowerCase();
    return (option.filterText || option.value || '').toLowerCase().includes(kw);
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
                    width: '32%',
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
                    width: 150,
                    render: (val, record, idx) => (
                      <div>
                        <Select
                          style={{ width: 104, marginBottom: record.useSlots ? 6 : 0 }}
                          optionList={[
                            { value: 'daily', label: t('整日') },
                            { value: 'slots', label: t('分时段') },
                          ]}
                          value={record.useSlots ? 'slots' : 'daily'}
                          onChange={(v) =>
                            updateRow(idx, 'useSlots', v === 'slots')
                          }
                        />
                        {!record.useSlots && (
                          <InputNumber
                            style={{ width: 104 }}
                            min={1}
                            step={1}
                            value={val}
                            onChange={(v) => updateRow(idx, 'limit', v)}
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    title: t('供应时段（北京时间）'),
                    dataIndex: 'slots',
                    width: 340,
                    render: (slots, record, rowIdx) => {
                      if (!record.useSlots) {
                        return (
                          <Text type='tertiary' size='small'>
                            {t('全天供应')}
                          </Text>
                        );
                      }
                      return (
                        <div>
                          {(slots || []).map((slot, slotIdx) => (
                            <div
                              key={slotIdx}
                              className='flex items-center gap-1 mb-1'
                            >
                              <Select
                                style={{ width: 82 }}
                                optionList={hourOptions}
                                value={slot.start}
                                onChange={(v) =>
                                  updateRowSlot(rowIdx, slotIdx, 'start', v)
                                }
                              />
                              <Text type='tertiary'>-</Text>
                              <Select
                                style={{ width: 82 }}
                                optionList={endHourOptions}
                                value={slotEndToDisplay(slot.start, slot.end)}
                                onChange={(v) =>
                                  updateRowSlot(
                                    rowIdx,
                                    slotIdx,
                                    'end',
                                    slotEndToStore(v),
                                  )
                                }
                              />
                              <InputNumber
                                min={0}
                                step={1}
                                value={slot.limit}
                                prefix={t('上限')}
                                style={{ width: 105 }}
                                onChange={(v) =>
                                  updateRowSlot(rowIdx, slotIdx, 'limit', v)
                                }
                              />
                              <Button
                                theme='borderless'
                                type='danger'
                                icon={<IconDelete />}
                                onClick={() => removeRowSlot(rowIdx, slotIdx)}
                              />
                            </div>
                          ))}
                          <Button
                            size='small'
                            icon={<IconPlus />}
                            onClick={() => addRowSlot(rowIdx)}
                          >
                            {t('添加时段')}
                          </Button>
                        </div>
                      );
                    },
                  },
                  {
                    title: t('梯度计费'),
                    dataIndex: 'tiers',
                    width: 420,
                    render: (tiers, record, rowIdx) => (
                      <div>
                        {(tiers || []).map((tier, tierIdx) => (
                          <div
                            key={tierIdx}
                            className='flex items-center gap-1 mb-1'
                          >
                            <InputNumber
                              min={1}
                              value={tier.from}
                              prefix={t('起')}
                              style={{ width: 105 }}
                              onChange={(v) =>
                                updateRowTier(rowIdx, tierIdx, 'from', v)
                              }
                            />
                            <InputNumber
                              min={1}
                              value={tier.to}
                              prefix={t('止')}
                              style={{ width: 105 }}
                              onChange={(v) =>
                                updateRowTier(rowIdx, tierIdx, 'to', v)
                              }
                            />
                            <InputNumber
                              min={0.01}
                              step={0.1}
                              value={tier.multiplier}
                              suffix='x'
                              style={{ width: 95 }}
                              onChange={(v) =>
                                updateRowTier(rowIdx, tierIdx, 'multiplier', v)
                              }
                            />
                            <Button
                              theme='borderless'
                              type='danger'
                              icon={<IconDelete />}
                              onClick={() => removeRowTier(rowIdx, tierIdx)}
                            />
                          </div>
                        ))}
                        <Button
                          size='small'
                          icon={<IconPlus />}
                          onClick={() => addRowTier(rowIdx)}
                        >
                          {t('添加梯度')}
                        </Button>
                      </div>
                    ),
                  },
                  {
                    title: t('刷新时间（北京时间）'),
                    dataIndex: 'resetHour',
                    width: '20%',
                    render: (val, record, idx) => (
                      <Select
                        style={{ width: '100%' }}
                        optionList={resetHourOptions}
                        value={val ?? 0}
                        onChange={(v) => updateRow(idx, 'resetHour', v)}
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
                            <li>
                              {t('编辑此处后失焦，会自动同步到上方表格。')}
                            </li>
                            <li>
                              {t(
                                '每日次数按所选北京时间整点重置；未配置时默认 00:00。',
                              )}
                            </li>
                            <li>{t('仅统计成功的调用，失败请求不计入。')}</li>
                            <li>{t('每日上限必须为大于等于 1 的整数。')}</li>
                            <li>
                              {t('同一分组内所有用户共享该模型的每日额度。')}
                            </li>
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
                      <div style={{ marginBottom: 12 }}>
                        <Text type='tertiary' size='small'>
                          {t('刷新时间（北京时间）')}
                        </Text>
                        <Select
                          style={{ width: 240, marginTop: 4 }}
                          optionList={resetHourOptions}
                          value={card.resetHour ?? 0}
                          onChange={(v) => updateCard(cardIdx, 'resetHour', v)}
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
                              marginTop: 8,
                              padding: 10,
                              border: '1px solid var(--semi-color-border)',
                              borderRadius: 8,
                            }}
                          >
                            <div className='flex items-center gap-2'>
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
                                style={{ width: 160 }}
                                min={1}
                                step={1}
                                value={lim.limit}
                                prefix={t('每日上限')}
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
                            <div style={{ marginTop: 8 }}>
                              <Text type='tertiary' size='small'>
                                {t('梯度计费')}
                              </Text>
                              {(lim.tiers || []).map((tier, tierIdx) => (
                                <div
                                  key={tierIdx}
                                  className='flex items-center gap-2 mt-1'
                                >
                                  <InputNumber
                                    min={1}
                                    value={tier.from}
                                    prefix={t('起始次数')}
                                    style={{ width: 150 }}
                                    onChange={(v) =>
                                      updateCardTier(
                                        cardIdx,
                                        limIdx,
                                        tierIdx,
                                        'from',
                                        v,
                                      )
                                    }
                                  />
                                  <InputNumber
                                    min={1}
                                    value={tier.to}
                                    prefix={t('结束次数')}
                                    style={{ width: 150 }}
                                    onChange={(v) =>
                                      updateCardTier(
                                        cardIdx,
                                        limIdx,
                                        tierIdx,
                                        'to',
                                        v,
                                      )
                                    }
                                  />
                                  <InputNumber
                                    min={0.01}
                                    step={0.1}
                                    value={tier.multiplier}
                                    prefix={t('倍率')}
                                    suffix='x'
                                    style={{ width: 130 }}
                                    onChange={(v) =>
                                      updateCardTier(
                                        cardIdx,
                                        limIdx,
                                        tierIdx,
                                        'multiplier',
                                        v,
                                      )
                                    }
                                  />
                                  <Button
                                    theme='borderless'
                                    type='danger'
                                    icon={<IconDelete />}
                                    onClick={() =>
                                      removeCardTier(cardIdx, limIdx, tierIdx)
                                    }
                                  />
                                </div>
                              ))}
                              <Button
                                size='small'
                                style={{ marginTop: 6 }}
                                icon={<IconPlus />}
                                onClick={() => addCardTier(cardIdx, limIdx)}
                              >
                                {t('添加梯度')}
                              </Button>
                            </div>
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

                      {/* 共享组分时段供应：按分组的时段列表，优先于整日上限 */}
                      <div style={{ marginTop: 12 }}>
                        <Text type='tertiary' size='small'>
                          {t('分时段供应（可选，优先于整日上限）')}
                        </Text>
                        {(card.timeSlots || []).map((slotRow, slotRowIdx) => (
                          <div
                            key={slotRowIdx}
                            style={{
                              marginTop: 8,
                              padding: 10,
                              border: '1px solid var(--semi-color-border)',
                              borderRadius: 8,
                            }}
                          >
                            <div className='flex items-center gap-2'>
                              <Select
                                filter
                                style={{ width: 220 }}
                                placeholder={t('分组')}
                                optionList={groupOptions}
                                value={slotRow.group || undefined}
                                allowCreate
                                onChange={(v) =>
                                  updateCardTimeSlotRow(
                                    cardIdx,
                                    slotRowIdx,
                                    'group',
                                    v,
                                  )
                                }
                              />
                              <Button
                                theme='borderless'
                                type='danger'
                                icon={<IconDelete />}
                                onClick={() =>
                                  removeCardTimeSlotRow(cardIdx, slotRowIdx)
                                }
                              />
                            </div>
                            <div style={{ marginTop: 8 }}>
                              {(slotRow.slots || []).map((slot, slotIdx) => (
                                <div
                                  key={slotIdx}
                                  className='flex items-center gap-2 mt-1'
                                >
                                  <Select
                                    style={{ width: 92 }}
                                    optionList={hourOptions}
                                    value={slot.start}
                                    onChange={(v) =>
                                      updateCardSlot(
                                        cardIdx,
                                        slotRowIdx,
                                        slotIdx,
                                        'start',
                                        v,
                                      )
                                    }
                                  />
                                  <Text type='tertiary'>-</Text>
                                  <Select
                                    style={{ width: 92 }}
                                    optionList={endHourOptions}
                                    value={slotEndToDisplay(
                                      slot.start,
                                      slot.end,
                                    )}
                                    onChange={(v) =>
                                      updateCardSlot(
                                        cardIdx,
                                        slotRowIdx,
                                        slotIdx,
                                        'end',
                                        slotEndToStore(v),
                                      )
                                    }
                                  />
                                  <InputNumber
                                    min={0}
                                    step={1}
                                    value={slot.limit}
                                    prefix={t('上限')}
                                    style={{ width: 120 }}
                                    onChange={(v) =>
                                      updateCardSlot(
                                        cardIdx,
                                        slotRowIdx,
                                        slotIdx,
                                        'limit',
                                        v,
                                      )
                                    }
                                  />
                                  <Button
                                    theme='borderless'
                                    type='danger'
                                    icon={<IconDelete />}
                                    onClick={() =>
                                      removeCardSlot(
                                        cardIdx,
                                        slotRowIdx,
                                        slotIdx,
                                      )
                                    }
                                  />
                                </div>
                              ))}
                              <Button
                                size='small'
                                style={{ marginTop: 6 }}
                                icon={<IconPlus />}
                                onClick={() => addCardSlot(cardIdx, slotRowIdx)}
                              >
                                {t('添加时段')}
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          size='small'
                          style={{ marginTop: 8 }}
                          icon={<IconPlus />}
                          onClick={() => addCardTimeSlotRow(cardIdx)}
                        >
                          {t('添加分组时段')}
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
                            <li>
                              {t('编辑此处后失焦，会自动同步到上方卡片。')}
                            </li>
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
