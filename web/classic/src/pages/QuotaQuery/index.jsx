import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Radio, Spin, Typography } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { API, renderQuota, showError, showSuccess } from '../../helpers';

const QuotaQuery = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [queryType, setQueryType] = useState('username');
  const [value, setValue] = useState('');
  const [result, setResult] = useState(null);

  const load = async () => {
    try {
      const res = await API.get('/api/user/quota-query/status');
      if (!res.data?.success) return showError(res.data?.message);
      setStatus(res.data.data);
    } catch (e) { showError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const query = async () => {
    if (!value.trim()) return showError('请输入要查询的用户名、用户 ID 或 Discord ID');
    setQuerying(true);
    try {
      const res = await API.post('/api/user/quota-query', { query_type: queryType, value: value.trim() });
      if (!res.data?.success) return showError(res.data?.message);
      setResult(res.data.data);
      setStatus((old) => ({ ...old, used_today: res.data.data.used_today, remaining_today: res.data.data.remaining_today }));
      showSuccess('查询成功');
    } catch (e) { showError(e.message); } finally { setQuerying(false); }
  };

  if (loading) return <div className='mt-[60px] px-2'><Card><Spin spinning><div className='h-48' /></Spin></Card></div>;
  const exhausted = status.daily_limit > 0 && status.remaining_today <= 0;
  return (
    <div className='mt-[60px] px-2 max-w-3xl mx-auto'>
      <Card>
        <div className='flex flex-col items-center gap-4 py-6'>
          <Search size={48} className='text-blue-500' />
          <Typography.Title heading={3}>付费额度查询</Typography.Title>
          <Typography.Text type='tertiary'>按用户名、用户 ID 或 Discord ID 精确查询当前余额。每次收费 {renderQuota(status.fee)}，费用进入低保池。</Typography.Text>
          <Typography.Text>今日已查询 {status.used_today} 次{status.daily_limit > 0 ? `，剩余 ${status.remaining_today} 次` : '，不限次数'}</Typography.Text>
          <Form className='w-full max-w-lg'>
            <Form.Slot label='查询方式'><Radio.Group value={queryType} onChange={(e) => setQueryType(e.target.value)}><Radio value='username'>用户名</Radio><Radio value='id'>用户 ID</Radio><Radio value='discord_id'>Discord ID</Radio></Radio.Group></Form.Slot>
            <Form.Input
              label={queryType === 'id' ? '用户 ID' : queryType === 'discord_id' ? 'Discord ID' : '用户名'}
              value={value}
              onChange={setValue}
              placeholder={queryType === 'id' ? '请输入完整用户 ID' : queryType === 'discord_id' ? '请输入完整 Discord 用户数字 ID' : '请输入完整用户名'}
            />
          </Form>
          <Button theme='solid' loading={querying} disabled={!status.enabled || exhausted || querying} onClick={query}>{!status.enabled ? '功能未启用' : exhausted ? '今日次数已用完' : '确认付费查询'}</Button>
          {result && <Card className='w-full max-w-lg' title='查询结果'><div className='flex justify-between'><Typography.Text>{result.target_username}（ID {result.target_user_id}）</Typography.Text><Typography.Title heading={4}>{renderQuota(result.quota)}</Typography.Title></div></Card>}
        </div>
      </Card>
    </div>
  );
};

export default QuotaQuery;
