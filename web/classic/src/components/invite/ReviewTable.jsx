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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';

const PAGE_SIZE = 20;

// 后端 UserReview 状态：0=待审核 1=已通过
const STATUS_META = {
  0: { label: '待审核', color: 'blue' },
  1: { label: '已通过', color: 'green' },
};

// Discord 的 joined_at 为 ISO 8601 且含 6 位微秒，需截断到毫秒再解析
const formatDiscordTime = (raw) => {
  if (!raw) return '';
  const parsed = new Date(raw.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(parsed.getTime())) return raw;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(
    parsed.getDate(),
  )} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(
    parsed.getSeconds(),
  )}`;
};

/**
 * 审查员视图：申请列表与审批操作。
 * 可见性与操作权限由后端校验（审核员白名单或管理员）。
 */
const ReviewTable = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('0');
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [handlingId, setHandlingId] = useState(null);
  const [discordVisible, setDiscordVisible] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordData, setDiscordData] = useState(null);

  // override 用于在同一次事件中立即生效（setState 异步，闭包内读到的是旧值）
  const load = useCallback(async (nextPage = 1, override = {}) => {
    const effectiveKeyword =
      override.keyword !== undefined ? override.keyword : keyword;
    const effectiveStatus =
      override.status !== undefined ? override.status : statusFilter;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        p: String(nextPage),
        page_size: String(PAGE_SIZE),
      });
      if (effectiveStatus !== '') {
        params.set('status', effectiveStatus);
      }
      if (effectiveKeyword) {
        params.set('keyword', effectiveKeyword);
      }
      const res = await API.get(`/api/user_review?${params.toString()}`);
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setItems(data.items || []);
      setPage(data.page || nextPage);
      setTotal(data.total || 0);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, keyword]);

  useEffect(() => {
    load(1);
    // 筛选条件变化时由各自的 onChange 主动触发，此处仅首次加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = (record) => {
    Modal.confirm({
      title: t('批准申请'),
      content: t(
        '确认批准 {{username}} 的申请？批准后将为其创建账号，该用户即可登录。',
        { username: record.username },
      ),
      okText: t('批准'),
      cancelText: t('取消'),
      centered: true,
      onOk: async () => {
        setHandlingId(record.id);
        try {
          const res = await API.post(`/api/user_review/${record.id}/approve`);
          const { success, message } = res.data;
          if (!success) {
            showError(message);
            return;
          }
          showSuccess(t('已批准'));
          load(page);
        } catch (error) {
          showError(error.message);
        } finally {
          setHandlingId(null);
        }
      },
    });
  };

  const handleReject = (record) => {
    Modal.confirm({
      title: t('驳回申请'),
      content: t(
        '确认驳回 {{username}} 的申请？申请记录将被删除，该用户可以重新注册申请。',
        { username: record.username },
      ),
      okText: t('驳回'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        setHandlingId(record.id);
        try {
          const res = await API.post(`/api/user_review/${record.id}/reject`);
          const { success, message } = res.data;
          if (!success) {
            showError(message);
            return;
          }
          showSuccess(t('已驳回'));
          load(page);
        } catch (error) {
          showError(error.message);
        } finally {
          setHandlingId(null);
        }
      },
    });
  };

  const handleViewDiscord = async (record) => {
    setDiscordVisible(true);
    setDiscordLoading(true);
    setDiscordData(null);
    try {
      const res = await API.get(`/api/user_review/${record.id}/discord`);
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setDiscordData(data);
    } catch (error) {
      showError(error.message);
    } finally {
      setDiscordLoading(false);
    }
  };

  const columns = [
    { title: t('用户名'), dataIndex: 'username', width: 140 },
    {
      title: t('邮箱'),
      dataIndex: 'email',
      width: 180,
      render: (v) => v || '-',
    },
    {
      title: t('申请理由'),
      dataIndex: 'reason',
      render: (v) => (
        <Typography.Paragraph
          ellipsis={{ rows: 3, expandable: true, collapsible: true }}
          style={{ maxWidth: 320, marginBottom: 0 }}
        >
          {v || '-'}
        </Typography.Paragraph>
      ),
    },
    {
      title: t('联系方式'),
      dataIndex: 'contact',
      width: 160,
      render: (v) => v || '-',
    },
    {
      title: t('提交时间'),
      dataIndex: 'created_at',
      width: 170,
      render: (v) => timestamp2string(v),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 100,
      render: (v) => {
        const meta = STATUS_META[v];
        return meta ? (
          <Tag color={meta.color} shape='circle'>
            {t(meta.label)}
          </Tag>
        ) : (
          '-'
        );
      },
    },
    {
      title: t('操作'),
      dataIndex: 'op',
      width: 250,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {record.status === 0 ? (
            <>
              <Button
                size='small'
                theme='light'
                type='primary'
                loading={handlingId === record.id}
                onClick={() => handleApprove(record)}
              >
                {t('批准')}
              </Button>
              <Button
                size='small'
                theme='light'
                type='danger'
                loading={handlingId === record.id}
                onClick={() => handleReject(record)}
              >
                {t('驳回')}
              </Button>
            </>
          ) : (
            <Typography.Text type='tertiary'>-</Typography.Text>
          )}
          <Button
            size='small'
            theme='borderless'
            onClick={() => handleViewDiscord(record)}
          >
            {t('Discord 信息')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card className='!rounded-2xl shadow-sm border-0'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
        <div>
          <Typography.Title heading={4} style={{ marginBottom: 4 }}>
            {t('注册审核')}
          </Typography.Title>
          <Typography.Text type='tertiary'>
            {t('批准后系统会为该申请人创建账号；驳回则删除申请记录，申请人可重新申请')}
          </Typography.Text>
        </div>
        <Space>
          <Input
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t('搜索用户名 / 邮箱 / 联系方式')}
            onEnterPress={() => {
              const next = searchInput.trim();
              setKeyword(next);
              load(1, { keyword: next });
            }}
            style={{ width: 220 }}
          />
          <Select
            value={statusFilter}
            style={{ width: 140 }}
            onChange={(v) => {
              setStatusFilter(v);
              load(1, { status: v });
            }}
            optionList={[
              { value: '0', label: t('待审核') },
              { value: '1', label: t('已通过') },
              { value: '', label: t('全部') },
            ]}
          />
          <Button
            onClick={() => {
              const next = searchInput.trim();
              setKeyword(next);
              load(1, { keyword: next });
            }}
          >
            {t('搜索')}
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey='id'
          pagination={{
            currentPage: page,
            pageSize: PAGE_SIZE,
            total,
            onPageChange: (p) => load(p),
          }}
          empty={<Empty description={t('暂无申请')} />}
        />
      </Spin>

      <Modal
        title={t('Discord 信息')}
        visible={discordVisible}
        onCancel={() => setDiscordVisible(false)}
        footer={null}
        centered
        width={640}
      >
        {discordLoading ? (
          <div className='flex justify-center py-8'>
            <Spin />
          </div>
        ) : discordData ? (
          <div className='space-y-4'>
            <div className='flex items-center gap-3'>
              {discordData.avatar_url && (
                <img
                  src={discordData.avatar_url}
                  alt='avatar'
                  className='w-12 h-12 rounded-full'
                />
              )}
              <div>
                <div className='font-medium'>
                  {discordData.global_name ||
                    discordData.username ||
                    discordData.user_id}
                </div>
                <div className='text-xs text-semi-color-text-2'>
                  ID: {discordData.user_id}
                </div>
              </div>
            </div>
            {(discordData.memberships || []).map((m) => (
              <div key={m.guild_id} className='p-3 rounded-lg bg-semi-color-fill-0'>
                <div className='flex items-center gap-2 mb-2'>
                  <Typography.Text strong>{m.guild_name}</Typography.Text>
                  {m.in_guild ? (
                    <Tag color='green' shape='circle'>
                      {t('已在服务器中')}
                    </Tag>
                  ) : (
                    <Tag color='grey' shape='circle'>
                      {t('不在服务器中')}
                    </Tag>
                  )}
                </div>
                {m.in_guild ? (
                  <>
                    {m.nick && (
                      <div className='text-sm mb-1'>
                        {t('服务器昵称')}：{m.nick}
                      </div>
                    )}
                    {m.joined_at && (
                      <div className='text-sm mb-1'>
                        {t('加入时间')}：{formatDiscordTime(m.joined_at)}
                      </div>
                    )}
                    <div className='text-sm mb-1'>{t('身份组')}：</div>
                    <Space wrap>
                      {(m.roles || []).length > 0 ? (
                        m.roles.map((r) => (
                          <Tag key={r.id} color='blue' shape='circle'>
                            {r.name || r.id}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type='tertiary'>
                          {t('无身份组')}
                        </Typography.Text>
                      )}
                    </Space>
                  </>
                ) : (
                  <Typography.Text type='tertiary'>
                    {m.error || t('不在该服务器中')}
                  </Typography.Text>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty description={t('暂无数据')} />
        )}
      </Modal>
    </Card>
  );
};

export default ReviewTable;
