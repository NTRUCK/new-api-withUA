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
  Avatar,
  Button,
  Card,
  Empty,
  Modal,
  Pagination,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  API,
  isAdmin,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';

const PAGE_SIZE = 20;

const Violations = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [removingAll, setRemovingAll] = useState(false);
  const admin = isAdmin();

  const load = async (nextPage = 1) => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/violations?p=${nextPage}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (!success) return showError(message);
      setItems(data.items || []);
      setPage(data.page || nextPage);
      setTotal(data.total || 0);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const handleRemove = (item) => {
    Modal.confirm({
      title: t('确认下榜'),
      content: t('确定将该用户从公开违规榜下榜吗？'),
      okText: t('确认下榜'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        setRemovingId(item.user_id);
        try {
          const res = await API.delete(`/api/violation/admin/${item.user_id}`);
          const { success, message } = res.data;
          if (!success) return showError(message);
          showSuccess(t('已下榜'));
          load(page);
        } catch (error) {
          showError(error.message);
        } finally {
          setRemovingId(null);
        }
      },
    });
  };

  const handleRemoveAll = () => {
    Modal.confirm({
      title: t('确认一键下榜'),
      content: t(
        '确定将公开违规榜上的所有用户全部下榜吗？此操作会清空当前榜单。',
      ),
      okText: t('确认一键下榜'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        setRemovingAll(true);
        try {
          const res = await API.delete('/api/violation/admin');
          const { success, message, data } = res.data;
          if (!success) return showError(message);
          showSuccess(
            t('已下榜 {{count}} 人', { count: data?.removed_count ?? 0 }),
          );
          load(1);
        } catch (error) {
          showError(error.message);
        } finally {
          setRemovingAll(false);
        }
      },
    });
  };

  return (
    <div className='mt-[60px] max-w-6xl mx-auto px-4 py-8'>
      <div className='mb-6 flex flex-wrap items-start justify-between gap-3'>
        <div>
          <Typography.Title heading={2}>违规榜</Typography.Title>
          <Typography.Text type='tertiary'>
            仅登录用户可查看已确认的违规记录
          </Typography.Text>
        </div>
        {admin && items.length > 0 && (
          <Button
            type='danger'
            theme='light'
            loading={removingAll}
            onClick={handleRemoveAll}
          >
            {t('一键下榜')}
          </Button>
        )}
      </div>
      <Spin spinning={loading} style={{ width: '100%' }}>
        {items.length === 0 && !loading ? (
          <Empty description={t('暂无违规记录')} />
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            {items.map((item, index) => (
              <Card
                key={`${item.discord_username}-${item.last_recorded_at}-${index}`}
                className='!rounded-xl'
              >
                <div className='flex gap-4'>
                  <Avatar src={item.avatar_url} size='large'>
                    {(item.display_name || item.discord_username || '?')[0]}
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Typography.Text strong>
                        {item.display_name || t('未知用户')}
                      </Typography.Text>
                      <Tag color='red'>
                        {t('使用违规客户端 {{count}} 次', {
                          count: item.client_usage_count ?? 0,
                        })}
                      </Tag>
                    </div>
                    {item.discord_username && (
                      <div className='mt-1'>
                        <Typography.Text
                          type='tertiary'
                          size='small'
                          copyable={{ content: item.discord_username }}
                        >
                          dcid：{item.discord_username}
                        </Typography.Text>
                      </div>
                    )}
                    <Typography.Paragraph className='mt-3 mb-3 whitespace-pre-wrap break-words'>
                      {item.reason}
                    </Typography.Paragraph>
                    {item.user_agent && (
                      <div className='mb-3 min-w-0'>
                        <Typography.Text
                          type='tertiary'
                          size='small'
                          ellipsis={{ showTooltip: true }}
                          copyable={{ content: item.user_agent }}
                          style={{ display: 'block' }}
                        >
                          User-Agent：{item.user_agent}
                        </Typography.Text>
                      </div>
                    )}
                    <div className='flex flex-wrap gap-x-5 gap-y-1'>
                      <Typography.Text size='small' type='tertiary'>
                        {t('首次记录')}：
                        {timestamp2string(item.first_recorded_at)}
                      </Typography.Text>
                      <Typography.Text size='small' type='tertiary'>
                        {t('最近记录')}：
                        {timestamp2string(item.last_recorded_at)}
                      </Typography.Text>
                    </div>
                    {admin && (
                      <div className='mt-3'>
                        <Button
                          size='small'
                          type='danger'
                          theme='light'
                          loading={removingId === item.user_id}
                          onClick={() => handleRemove(item)}
                        >
                          {t('下榜')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Spin>
      {total > PAGE_SIZE && (
        <div className='flex justify-center mt-6'>
          <Pagination
            currentPage={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={load}
          />
        </div>
      )}
    </div>
  );
};

export default Violations;
