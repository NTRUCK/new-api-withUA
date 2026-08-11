import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Spin,
  Typography,
} from '@douyinfe/semi-ui';
import { HandCoins } from 'lucide-react';
import { API, isAdmin, renderQuota, showError, showSuccess } from '../../helpers';
import { displayAmountToQuota, quotaToDisplayAmount } from '../../helpers/quota';
import { getCurrencyConfig } from '../../helpers/render';

const DiceWelfare = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adminForm, setAdminForm] = useState({
    name: '低保池拼手气红包',
    total: 5000,
    maxUses: 100,
    min: 30,
    max: 80,
  });
  const currency = getCurrencyConfig();
  const currencySymbol = currency.type === 'TOKENS' ? '' : currency.symbol;

  const loadStatus = async () => {
    try {
      const res = await API.get('/api/user/welfare');
      if (!res.data?.success) return showError(res.data?.message);
      setStatus(res.data.data);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const apply = async () => {
    setApplying(true);
    try {
      const res = await API.post('/api/user/welfare');
      if (!res.data?.success) return showError(res.data?.message);
      showSuccess(res.data.data.round_completed ? '本期人数已满，红包已自动生成并交由管理员发放' : '申请成功');
      await loadStatus();
    } catch (e) {
      showError(e.message);
    } finally {
      setApplying(false);
    }
  };

  const createRedemption = async () => {
    setCreating(true);
    try {
      const res = await API.post('/api/user/welfare/admin/redemption', {
        name: adminForm.name,
        total_quota: displayAmountToQuota(adminForm.total),
        max_uses: Number(adminForm.maxUses),
        min_quota: displayAmountToQuota(adminForm.min),
        max_quota: displayAmountToQuota(adminForm.max),
      });
      if (!res.data?.success) return showError(res.data?.message);
      Modal.success({
        title: '红包兑换码已创建',
        content: <Typography.Text copyable>{res.data.data.key}</Typography.Text>,
      });
      await loadStatus();
    } catch (e) {
      showError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className='mt-[60px] px-2'><Card><Spin spinning><div style={{ height: 180 }} /></Spin></Card></div>;
  }

  const percent = Math.min(100, Math.round((status.applicant_count / status.required_applicants) * 100));

  return (
    <div className='mt-[60px] px-2 flex flex-col gap-4'>
      <Card>
        <div className='flex flex-col items-center gap-4 py-8 text-center'>
          <HandCoins size={52} className='text-emerald-500' />
          <Typography.Title heading={3} className='!mb-0'>低保池红包申请</Typography.Title>
          <Typography.Text type='tertiary'>
            每期每人可申请一次。满 50 人且池内额度达到 5000 后，系统自动生成 100 份、单份 30～80 的拼手气兑换码，由管理员在社区发放。
          </Typography.Text>
          <div className='grid grid-cols-1 sm:grid-cols-4 gap-3 w-full max-w-4xl'>
            <Card shadows='hover'><Typography.Text type='tertiary'>当前低保池</Typography.Text><div className='text-xl font-semibold mt-1'>{renderQuota(status.welfare_pool)}</div></Card>
            <Card shadows='hover'><Typography.Text type='tertiary'>当前期数</Typography.Text><div className='text-xl font-semibold mt-1'>第 {status.round_id} 期</div></Card>
            <Card shadows='hover'><Typography.Text type='tertiary'>申请人数</Typography.Text><div className='text-xl font-semibold mt-1'>{status.applicant_count}/{status.required_applicants}</div></Card>
            <Card shadows='hover'><Typography.Text type='tertiary'>所需额度</Typography.Text><div className='text-xl font-semibold mt-1'>{renderQuota(status.target_quota)}</div></Card>
          </div>
          <div className='w-full max-w-xl'><Progress percent={percent} showInfo /></div>
          {status.waiting_for_funds && <Typography.Text type='warning'>申请人数已满，正在等待低保池额度达到 {renderQuota(status.target_quota)}</Typography.Text>}
          <Button size='large' theme='solid' type='warning' loading={applying} disabled={status.applied || applying || status.waiting_for_funds} onClick={apply}>
            {status.applied ? '本期已申请' : status.waiting_for_funds ? '本期等待额度' : '申请本期红包'}
          </Button>
        </div>
      </Card>

      {isAdmin() && (
        <Card title='管理员自定义提取低保池红包'>
          <Typography.Text type='tertiary'>创建时从低保池原子扣除总额度，兑换码仅展示给管理员。</Typography.Text>
          <Form className='mt-4' layout='horizontal'>
            <Form.Slot label='名称'><Input value={adminForm.name} onChange={(v) => setAdminForm({ ...adminForm, name: v })} /></Form.Slot>
            <Form.Slot label='总额度'><InputNumber prefix={currencySymbol} value={adminForm.total} min={0} onChange={(v) => setAdminForm({ ...adminForm, total: v })} /></Form.Slot>
            <Form.Slot label='兑换次数'><InputNumber value={adminForm.maxUses} min={1} onChange={(v) => setAdminForm({ ...adminForm, maxUses: v })} /></Form.Slot>
            <Form.Slot label='单次下限'><InputNumber prefix={currencySymbol} value={adminForm.min} min={0} onChange={(v) => setAdminForm({ ...adminForm, min: v })} /></Form.Slot>
            <Form.Slot label='单次上限'><InputNumber prefix={currencySymbol} value={adminForm.max} min={0} onChange={(v) => setAdminForm({ ...adminForm, max: v })} /></Form.Slot>
          </Form>
          <Button theme='solid' loading={creating} onClick={createRedemption}>从低保池创建红包</Button>
          <Typography.Text type='tertiary' className='ml-3'>预计扣除 {renderQuota(displayAmountToQuota(adminForm.total))}，池余额 {quotaToDisplayAmount(status.welfare_pool)}</Typography.Text>
        </Card>
      )}
    </div>
  );
};

export default DiceWelfare;
