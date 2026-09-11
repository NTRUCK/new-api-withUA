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

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Button,
  Table,
  Tag,
  Typography,
  Banner,
} from '@douyinfe/semi-ui';
import { API, showError } from '../../../../helpers';
import { CHANNEL_OPTIONS } from '../../../../constants/channel.constants';

// 模型广场卡片上的渠道测试弹窗：按模型列出所有提供该模型的渠道，
// 支持全选/多选批量测试与单个渠道测试（仅管理员可见入口）
const ModelChannelTestModal = ({ visible, modelName, onClose, t }) => {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [testingIds, setTestingIds] = useState(() => new Set());
  const [results, setResults] = useState({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');

  useEffect(() => {
    if (!visible || !modelName) return;
    setChannels([]);
    setSelectedIds([]);
    setTestingIds(new Set());
    setResults({});
    const loadChannels = async () => {
      setLoading(true);
      try {
        const res = await API.get(
          `/api/channel/by_model?model=${encodeURIComponent(modelName)}`,
        );
        const { success, message, data } = res.data;
        if (success) {
          setChannels(data || []);
          // 默认全选，方便一键测试所有渠道
          setSelectedIds((data || []).map((ch) => ch.id));
        } else {
          showError(message || t('获取渠道列表失败'));
        }
      } catch (error) {
        showError(t('获取渠道列表失败'));
      } finally {
        setLoading(false);
      }
    };
    loadChannels();
  }, [visible, modelName, t]);

  const runTest = async (channelId) => {
    setTestingIds((prev) => new Set(prev).add(channelId));
    setResults((prev) => ({ ...prev, [channelId]: undefined }));
    let result;
    try {
      const res = await API.get(
        `/api/channel/test/${channelId}?model=${encodeURIComponent(modelName)}`,
      );
      const { success, message, time } = res.data;
      result = { success, message: message || '', time: time ?? 0 };
    } catch (error) {
      result = { success: false, message: t('请求失败'), time: 0 };
    }
    setResults((prev) => ({ ...prev, [channelId]: result }));
    setTestingIds((prev) => {
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
    return result;
  };

  const handleBatchTest = async () => {
    if (selectedIds.length === 0) {
      showError(t('请先选择渠道！'));
      return;
    }
    setBatchRunning(true);
    // 串行执行，避免并发触发上游限流
    for (const id of selectedIds) {
      await runTest(id);
    }
    setBatchRunning(false);
  };

  const getTypeLabel = (type) => {
    const option = CHANNEL_OPTIONS.find((opt) => opt.value === type);
    return option ? option.label : String(type);
  };

  const renderChannelStatus = (record) => {
    if (record.status !== 1) {
      return (
        <Tag color='red' shape='circle'>
          {t('已禁用')}
        </Tag>
      );
    }
    if (!record.ability_enabled) {
      return (
        <Tag color='grey' shape='circle'>
          {t('模型未启用')}
        </Tag>
      );
    }
    return (
      <Tag color='green' shape='circle'>
        {t('已启用')}
      </Tag>
    );
  };

  const columns = [
    {
      title: t('渠道'),
      dataIndex: 'name',
      render: (text, record) => (
        <div className='flex items-center gap-2'>
          <Typography.Text strong>{text}</Typography.Text>
          <Tag size='small' color='white' shape='circle'>
            #{record.id}
          </Tag>
        </div>
      ),
    },
    {
      title: t('类型'),
      dataIndex: 'type',
      width: 120,
      render: (text) => (
        <Typography.Text type='tertiary' size='small'>
          {getTypeLabel(text)}
        </Typography.Text>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 110,
      render: (text, record) => renderChannelStatus(record),
    },
    {
      title: t('分组'),
      dataIndex: 'groups',
      width: 100,
      render: (text) => (
        <Typography.Text type='tertiary' size='small'>
          {text}
        </Typography.Text>
      ),
    },
    {
      title: t('测试结果'),
      dataIndex: 'result',
      width: 190,
      render: (text, record) => {
        if (testingIds.has(record.id)) {
          return (
            <Tag color='blue' shape='circle'>
              {t('测试中')}
            </Tag>
          );
        }
        const result = results[record.id];
        if (!result) {
          return (
            <Tag color='grey' shape='circle'>
              {t('未开始')}
            </Tag>
          );
        }
        return (
          <div className='flex items-center gap-2 whitespace-nowrap'>
            <Tag color={result.success ? 'green' : 'red'} shape='circle'>
              {result.success ? t('成功') : t('失败')}
            </Tag>
            {result.success ? (
              <Typography.Text type='tertiary' size='small'>
                {t('请求时长: ${time}s').replace(
                  '${time}',
                  result.time.toFixed(2),
                )}
              </Typography.Text>
            ) : (
              result.message && (
                <Button
                  size='small'
                  type='danger'
                  theme='borderless'
                  onClick={() => setErrorDetail(result.message)}
                >
                  {t('错误详情')}
                </Button>
              )
            )}
          </div>
        );
      },
    },
    {
      title: '',
      dataIndex: 'operate',
      width: 90,
      render: (text, record) => {
        const isTesting = testingIds.has(record.id);
        return (
          <Button
            type='tertiary'
            size='small'
            loading={isTesting}
            disabled={batchRunning}
            onClick={() => runTest(record.id)}
          >
            {t('测试')}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <Modal
        title={
          <div className='flex items-center gap-2'>
            <Typography.Text
              strong
              className='!text-[var(--semi-color-text-0)] !text-base'
            >
              {modelName}
            </Typography.Text>
            <Typography.Text type='tertiary' size='small'>
              {t('的渠道测试')}
            </Typography.Text>
            {channels.length > 0 && (
              <Typography.Text type='tertiary' size='small'>
                {t('共')} {channels.length} {t('个渠道')}
              </Typography.Text>
            )}
          </div>
        }
        visible={visible}
        onCancel={onClose}
        footer={
          <div className='flex justify-end'>
            <Button type='tertiary' onClick={onClose} disabled={batchRunning}>
              {t('取消')}
            </Button>
            <Button
              onClick={handleBatchTest}
              loading={batchRunning}
              disabled={batchRunning || channels.length === 0}
            >
              {batchRunning
                ? t('测试中...')
                : t('测试选中${count}个渠道').replace(
                    '${count}',
                    selectedIds.length,
                  )}
            </Button>
          </div>
        }
        maskClosable={!batchRunning}
        className='!rounded-lg'
        size='large'
      >
        <Banner
          type='info'
          closeIcon={null}
          className='!rounded-lg mb-2'
          description={t(
            '说明：测试使用当前站点管理员配置的测试账号真实调用上游并计费；已禁用的渠道也可测试。',
          )}
        />
        <Table
          columns={columns}
          dataSource={channels.map((ch) => ({ ...ch, key: ch.id }))}
          loading={loading}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys),
            getCheckboxProps: () => ({
              disabled: batchRunning,
            }),
          }}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
          }}
          size='small'
          empty={t('暂无渠道提供该模型')}
        />
      </Modal>

      <Modal
        title={t('错误详情')}
        visible={!!errorDetail}
        onCancel={() => setErrorDetail('')}
        footer={
          <Button onClick={() => setErrorDetail('')}>{t('关闭')}</Button>
        }
        width={640}
      >
        <pre
          className='whitespace-pre-wrap break-words overflow-auto'
          style={{ maxHeight: '60vh', margin: 0, fontSize: 12 }}
        >
          {errorDetail}
        </pre>
      </Modal>
    </>
  );
};

export default ModelChannelTestModal;
