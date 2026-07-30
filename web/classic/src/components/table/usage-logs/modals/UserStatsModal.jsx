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

import React, { useEffect, useMemo } from 'react';
import {
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Modal,
  Pagination,
  Table,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import CardTable from '../../../common/ui/CardTable';
import { timestamp2string } from '../../../../helpers';
import { getLogsColumns } from '../UsageLogsColumnDefs';

const UserLogsPanel = ({ user, logsData }) => {
  const {
    userStatsLogs,
    userStatsLogsLoading,
    loadUserStatsLogs,
    visibleColumns,
    compactMode,
    t,
  } = logsData;
  const logData = userStatsLogs[user.user_id];
  const loading = Boolean(userStatsLogsLoading[user.user_id]);

  useEffect(() => {
    if (!logData && !loading) {
      loadUserStatsLogs(user.user_id, 1);
    }
  }, [user.user_id, logData, loading, loadUserStatsLogs]);

  const columns = useMemo(() => {
    const allColumns = getLogsColumns(logsData);
    const filtered = allColumns.filter((column) => visibleColumns[column.key]);
    return compactMode
      ? filtered.map(({ fixed, ...column }) => column)
      : filtered;
  }, [logsData, visibleColumns, compactMode]);

  const expandRowRender = (record) => (
    <Descriptions data={logData?.expandData[record.key] || []} />
  );

  return (
    <div className='p-2'>
      <CardTable
        columns={columns}
        dataSource={logData?.items || []}
        rowKey='key'
        loading={loading}
        size='small'
        scroll={compactMode ? undefined : { x: 'max-content' }}
        expandedRowRender={expandRowRender}
        expandRowByClick
        rowExpandable={(record) =>
          Boolean(logData?.expandData[record.key]?.length)
        }
        pagination={false}
        hidePagination
        empty={
          <Empty
            image={<IllustrationNoResult style={{ width: 100, height: 100 }} />}
            darkModeImage={
              <IllustrationNoResultDark style={{ width: 100, height: 100 }} />
            }
            description={t('搜索无结果')}
            style={{ padding: 20 }}
          />
        }
      />
      {logData?.total > 20 && (
        <div className='flex justify-end mt-3'>
          <Pagination
            currentPage={logData.page}
            pageSize={20}
            total={logData.total}
            onPageChange={(page) => loadUserStatsLogs(user.user_id, page)}
          />
        </div>
      )}
    </div>
  );
};

const UserStatsModal = (logsData) => {
  const {
    showUserStats,
    closeUserStats,
    userStats,
    userStatsLoading,
    userStatsPage,
    userStatsPageSize,
    userStatsTotal,
    userStatsExcludeAdmins,
    setUserStatsExcludeAdmins,
    loadUserStats,
    isAdminUser,
    batchDisableLoading,
    batchDisableByLogs,
    getFormValues,
    t,
  } = logsData;

  const confirmBatchDisable = () => {
    if (!isAdminUser || batchDisableLoading) return;
    const { user_agent } = getFormValues();
    if (!user_agent.trim()) {
      batchDisableByLogs();
      return;
    }
    Modal.confirm({
      title: t('确认批量封禁用户'),
      content: (
        <div className='flex flex-col gap-2'>
          <Typography.Text>
            {t('将按照当前全部日志筛选条件批量封禁匹配用户。')}
          </Typography.Text>
          <Typography.Text strong type='danger'>
            {t('User ID 1 和所有管理员永远不会被封禁。')}
          </Typography.Text>
        </div>
      ),
      okText: t('确认批量封禁'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: batchDisableByLogs,
    });
  };

  const handleExcludeAdminsChange = (event) => {
    const checked = event.target.checked;
    setUserStatsExcludeAdmins(checked);
    loadUserStats(1, checked);
  };

  const columns = [
    {
      title: t('用户 ID'),
      dataIndex: 'user_id',
      key: 'user_id',
      width: 100,
    },
    {
      title: t('用户名'),
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: t('日志数量'),
      dataIndex: 'log_count',
      key: 'log_count',
    },
    {
      title: t('最后日志时间'),
      dataIndex: 'last_created_at',
      key: 'last_created_at',
      render: (value) => (value ? timestamp2string(value) : '-'),
    },
  ];

  return (
    <Modal
      title={t('统计用户')}
      visible={showUserStats}
      onCancel={closeUserStats}
      footer={null}
      width={1000}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      bodyStyle={{ maxHeight: 'calc(100vh - 160px)', overflow: 'hidden' }}
      centered
    >
      {isAdminUser && (
        <div className='flex justify-between items-center mb-4'>
          <Checkbox
            checked={userStatsExcludeAdmins}
            onChange={handleExcludeAdminsChange}
          >
            {t('排除管理员日志')}
          </Checkbox>
          <Button
            type='danger'
            theme='solid'
            loading={batchDisableLoading}
            disabled={batchDisableLoading}
            onClick={confirmBatchDisable}
          >
            {t('按当前筛选批量封禁')}
          </Button>
        </div>
      )}
      <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
        <Table
          columns={columns}
          dataSource={userStats}
          rowKey='user_id'
          loading={userStatsLoading}
          size='small'
          pagination={false}
          expandRowByClick
          expandedRowRender={(user) => (
            <UserLogsPanel user={user} logsData={logsData} />
          )}
          empty={
            <Empty
              image={
                <IllustrationNoResult style={{ width: 150, height: 150 }} />
              }
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
              }
              description={t('搜索无结果')}
              style={{ padding: 30 }}
            />
          }
        />
      </div>
      {userStatsTotal > userStatsPageSize && (
        <div className='flex justify-end mt-4'>
          <Pagination
            currentPage={userStatsPage}
            pageSize={userStatsPageSize}
            total={userStatsTotal}
            onPageChange={loadUserStats}
          />
        </div>
      )}
    </Modal>
  );
};

export default UserStatsModal;
