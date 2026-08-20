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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Modal,
  Pagination,
  Radio,
  RadioGroup,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import CardTable from '../../../common/ui/CardTable';
import { timestamp2string } from '../../../../helpers';
import { getLogsColumns } from '../UsageLogsColumnDefs';

const ViolationForm = ({ t, getFormApi, initialListed = true }) => (
  <Form
    getFormApi={getFormApi}
    initValues={{
      reason_code: 'tavo_client',
      reason_text: '',
      list_publicly: initialListed,
    }}
    labelPosition='top'
  >
    {({ values }) => (
      <>
        <Form.Select
          field='reason_code'
          label={t('违规原因')}
          optionList={[
            { value: 'tavo_client', label: t('TAVO 客户端') },
            { value: 'custom', label: t('其他原因') },
          ]}
          rules={[{ required: true }]}
        />
        {values.reason_code === 'custom' && (
          <Form.TextArea
            field='reason_text'
            label={t('原因说明')}
            maxCount={200}
            maxLength={200}
            autosize={{ minRows: 2, maxRows: 5 }}
            rules={[
              { required: true, message: t('请填写原因说明') },
              { max: 200, message: t('原因说明不能超过 200 字') },
            ]}
          />
        )}
        <Form.Checkbox field='list_publicly'>
          {t('加入公开违规榜')}
        </Form.Checkbox>
      </>
    )}
  </Form>
);

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
    if (!logData && !loading) loadUserStatsLogs(user.user_id, 1);
  }, [user.user_id, logData, loading, loadUserStatsLogs]);

  const columns = useMemo(() => {
    const filtered = getLogsColumns(logsData).filter(
      (column) => visibleColumns[column.key],
    );
    return compactMode
      ? filtered.map(({ fixed, ...column }) => column)
      : filtered;
  }, [logsData, visibleColumns, compactMode]);

  return (
    <div className='p-2 min-w-0'>
      <div className='w-full overflow-x-auto pb-1'>
        <div style={{ minWidth: compactMode ? 760 : 1200 }}>
          <CardTable
            columns={columns}
            resizable
            dataSource={logData?.items || []}
            rowKey='key'
            loading={loading}
            size='small'
            scroll={{ x: 'max-content' }}
            expandedRowRender={(record) => (
              <Descriptions data={logData?.expandData[record.key] || []} />
            )}
            expandRowByClick
            rowExpandable={(record) =>
              Boolean(logData?.expandData[record.key]?.length)
            }
            pagination={false}
            hidePagination
          />
        </div>
      </div>
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
    userStatsWhitelist,
    setUserStatsWhitelist,
    loadUserStats,
    isAdminUser,
    batchDisableLoading,
    batchDisableByLogs,
    batchDisableInactive,
    inactiveUsers,
    inactiveUsersLoading,
    inactiveUsersPage,
    inactiveUsersTotal,
    loadInactiveUsers,
    violationLoading,
    recordViolation,
    getFormValues,
    t,
  } = logsData;
  const [mode, setMode] = useState('logs');
  const [inactiveRange, setInactiveRange] = useState(() => [
    new Date(Date.now() - 7 * 24 * 3600 * 1000),
    new Date(),
  ]);

  const showViolationForm = (userId, initialListed = true) => {
    let formApi;
    Modal.confirm({
      title: t('记录违规/上榜'),
      content: (
        <ViolationForm
          t={t}
          initialListed={initialListed}
          getFormApi={(api) => {
            formApi = api;
          }}
        />
      ),
      okText: t('保存'),
      cancelText: t('取消'),
      onOk: async () => {
        await formApi.validate();
        const values = formApi.getValues();
        await recordViolation(userId, {
          reasonCode: values.reason_code,
          reasonText: values.reason_text,
          listPublicly: values.list_publicly,
        });
      },
    });
  };

  const confirmBatchDisable = () => {
    if (!isAdminUser || batchDisableLoading) return;
    if (!getFormValues().user_agent.trim()) {
      Modal.warning({ title: t('请先填写 User Agent 筛选条件') });
      return;
    }
    let formApi;
    const whitelistCount = userStatsWhitelist.length;
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
          {whitelistCount > 0 && (
            <Typography.Text strong type='warning'>
              {t('已勾选 {{count}} 个白名单用户，本次将被跳过。', {
                count: whitelistCount,
              })}
            </Typography.Text>
          )}
          <ViolationForm
            t={t}
            getFormApi={(api) => {
              formApi = api;
            }}
          />
        </div>
      ),
      okText: t('确认批量封禁'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        await formApi.validate();
        const values = formApi.getValues();
        return batchDisableByLogs({
          reason_code: values.reason_code,
          reason_text: values.reason_text,
          list_publicly: values.list_publicly,
        });
      },
    });
  };

  const confirmBatchDisableInactive = () => {
    if (!isAdminUser || batchDisableLoading) return;
    if (!inactiveRange?.[0] || !inactiveRange?.[1]) {
      Modal.warning({ title: t('请先选择时间范围') });
      return;
    }
    let formApi;
    const whitelistCount = userStatsWhitelist.length;
    Modal.confirm({
      title: t('确认批量封禁用户'),
      content: (
        <div className='flex flex-col gap-2'>
          <Typography.Text>
            {t('将封禁在所选时间段内没有任何调用的全部用户。')}
          </Typography.Text>
          <Typography.Text strong type='danger'>
            {t('User ID 1 和所有管理员永远不会被封禁。')}
          </Typography.Text>
          {whitelistCount > 0 && (
            <Typography.Text strong type='warning'>
              {t('已勾选 {{count}} 个白名单用户，本次将被跳过。', {
                count: whitelistCount,
              })}
            </Typography.Text>
          )}
          <ViolationForm
            t={t}
            getFormApi={(api) => {
              formApi = api;
            }}
          />
        </div>
      ),
      okText: t('确认批量封禁'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        await formApi.validate();
        const values = formApi.getValues();
        return batchDisableInactive(inactiveRange, {
          reason_code: values.reason_code,
          reason_text: values.reason_text,
          list_publicly: values.list_publicly,
        });
      },
    });
  };

  const toggleWhitelist = (userId) => {
    setUserStatsWhitelist((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const loadInactive = (page = 1, range = inactiveRange) => {
    if (!range?.[0] || !range?.[1]) return;
    loadInactiveUsers(page, {
      start: Math.floor(new Date(range[0]).getTime() / 1000),
      end: Math.floor(new Date(range[1]).getTime() / 1000),
    });
  };

  const handleModeChange = (event) => {
    const nextMode = event.target.value;
    setMode(nextMode);
    if (nextMode === 'inactive') loadInactive(1);
  };

  const actionColumn = (idKey) => ({
    title: t('操作'),
    key: 'action',
    width: 140,
    render: (_, record) => {
      const userId = record[idKey];
      return (
        <Button
          size='small'
          loading={Boolean(violationLoading[userId])}
          onClick={(event) => {
            event.stopPropagation();
            showViolationForm(userId, record.on_violation_board ?? true);
          }}
        >
          {record.on_violation_board ? t('更新上榜') : t('记录违规/上榜')}
        </Button>
      );
    },
  });

  const logColumns = [
    {
      title: t('白名单'),
      key: 'whitelist',
      width: 70,
      render: (_, record) => (
        <Checkbox
          checked={userStatsWhitelist.includes(record.user_id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleWhitelist(record.user_id)}
        />
      ),
    },
    { title: t('用户 ID'), dataIndex: 'user_id', key: 'user_id', width: 90 },
    { title: t('用户名'), dataIndex: 'username', key: 'username' },
    { title: t('日志数量'), dataIndex: 'log_count', key: 'log_count' },
    {
      title: t('最后日志时间'),
      dataIndex: 'last_created_at',
      key: 'last_created_at',
      render: (value) => (value ? timestamp2string(value) : '-'),
    },
    actionColumn('user_id'),
  ];

  const inactiveColumns = [
    {
      title: t('白名单'),
      key: 'whitelist',
      width: 70,
      render: (_, record) => (
        <Checkbox
          checked={userStatsWhitelist.includes(record.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleWhitelist(record.id)}
        />
      ),
    },
    { title: t('用户 ID'), dataIndex: 'id', key: 'id', width: 90 },
    { title: t('用户名'), dataIndex: 'username', key: 'username' },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      render: (value) => (
        <Tag color={value === 1 ? 'green' : 'red'}>
          {value === 1 ? t('正常') : t('已禁用')}
        </Tag>
      ),
    },
    {
      title: t('注册时间'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value) => (value ? timestamp2string(value) : '-'),
    },
    {
      title: t('最后登录时间'),
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      render: (value) => (value ? timestamp2string(value) : '-'),
    },
    {
      title: t('是否已上榜'),
      dataIndex: 'on_violation_board',
      key: 'on_violation_board',
      render: (value) => (value ? t('是') : t('否')),
    },
    actionColumn('id'),
  ];

  const isInactive = mode === 'inactive';
  const total = isInactive ? inactiveUsersTotal : userStatsTotal;
  const page = isInactive ? inactiveUsersPage : userStatsPage;

  return (
    <Modal
      title={t('统计用户')}
      visible={showUserStats}
      onCancel={closeUserStats}
      footer={null}
      width={1100}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      bodyStyle={{ maxHeight: 'calc(100vh - 160px)', overflow: 'hidden' }}
      centered
    >
      <RadioGroup
        type='button'
        value={mode}
        onChange={handleModeChange}
        className='mb-4'
      >
        <Radio value='logs'>{t('符合日志筛选')}</Radio>
        <Radio value='inactive'>{t('指定时间内无调用')}</Radio>
      </RadioGroup>
      <div className='flex flex-wrap justify-between items-center gap-3 mb-4'>
        {isInactive ? (
          <DatePicker
            type='dateTimeRange'
            value={inactiveRange}
            onChange={(value) => {
              setInactiveRange(value);
              loadInactive(1, value);
            }}
            placeholder={[t('开始时间'), t('结束时间')]}
          />
        ) : (
          <Checkbox
            checked={userStatsExcludeAdmins}
            onChange={(event) => {
              setUserStatsExcludeAdmins(event.target.checked);
              loadUserStats(1, event.target.checked);
            }}
          >
            {t('排除管理员日志')}
          </Checkbox>
        )}
        <div className='flex items-center gap-3'>
          <Typography.Text>
            {isInactive ? t('无调用用户数') : t('符合筛选的用户数')}：
            <Typography.Text strong>{total}</Typography.Text>
          </Typography.Text>
          {userStatsWhitelist.length > 0 && (
            <Typography.Text type='warning'>
              {t('白名单')}：
              <Typography.Text strong>
                {userStatsWhitelist.length}
              </Typography.Text>
              <Button
                size='small'
                theme='borderless'
                type='tertiary'
                onClick={() => setUserStatsWhitelist([])}
              >
                {t('清空')}
              </Button>
            </Typography.Text>
          )}
          <Button
            type='danger'
            theme='solid'
            loading={batchDisableLoading}
            onClick={
              isInactive ? confirmBatchDisableInactive : confirmBatchDisable
            }
          >
            {t('按当前筛选批量封禁')}
          </Button>
        </div>
      </div>
      <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        <Table
          columns={isInactive ? inactiveColumns : logColumns}
          dataSource={isInactive ? inactiveUsers : userStats}
          rowKey={isInactive ? 'id' : 'user_id'}
          loading={isInactive ? inactiveUsersLoading : userStatsLoading}
          size='small'
          pagination={false}
          expandRowByClick={!isInactive}
          expandedRowRender={
            isInactive
              ? undefined
              : (user) => <UserLogsPanel user={user} logsData={logsData} />
          }
          empty={
            <Empty
              image={
                <IllustrationNoResult style={{ width: 120, height: 120 }} />
              }
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 120, height: 120 }} />
              }
              description={t('搜索无结果')}
            />
          }
        />
      </div>
      {total > userStatsPageSize && (
        <div className='flex justify-end mt-4'>
          <Pagination
            currentPage={page}
            pageSize={userStatsPageSize}
            total={total}
            onPageChange={
              isInactive
                ? (nextPage) => loadInactive(nextPage, inactiveRange)
                : loadUserStats
            }
          />
        </div>
      )}
    </Modal>
  );
};

export default UserStatsModal;
