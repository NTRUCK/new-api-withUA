import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Spin, Typography } from '@douyinfe/semi-ui';
import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, renderQuota, showError, showSuccess } from '../../helpers';

const DiceWelfare = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await API.get('/api/user/dice_game');
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

  const claim = async () => {
    setClaiming(true);
    try {
      const res = await API.post('/api/user/dice_game/welfare');
      if (!res.data?.success) return showError(res.data?.message);
      showSuccess(
        t('成功领取低保 {{quota}}', {
          quota: renderQuota(res.data.data.granted),
        }),
      );
      await loadStatus();
    } catch (e) {
      showError(e.message);
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className='mt-[60px] px-2'>
        <Card><Spin spinning><div style={{ height: 180 }} /></Spin></Card>
      </div>
    );
  }

  if (!status?.enabled) {
    return <div className='mt-[60px] px-2'><Card><Empty description={t('小游戏功能未启用')} /></Card></div>;
  }

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <div className='flex flex-col items-center gap-4 py-8 text-center'>
          <HandCoins size={52} className='text-emerald-500' />
          <Typography.Title heading={3} className='!mb-0'>
            {t('领取低保')}
          </Typography.Title>
          <Typography.Text type='tertiary'>
            {t('用户输掉的下注会进入低保池；池不足每日上限时，将领取池中剩余额度。')}
          </Typography.Text>
          <div className='grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl'>
            <Card shadows='hover'><Typography.Text type='tertiary'>{t('当前低保池')}</Typography.Text><div className='text-xl font-semibold mt-1'>{renderQuota(status.welfare_pool || 0)}</div></Card>
            <Card shadows='hover'><Typography.Text type='tertiary'>{t('低保领取余额线')}</Typography.Text><div className='text-xl font-semibold mt-1'>{renderQuota(status.welfare_balance_threshold || 0)}</div></Card>
            <Card shadows='hover'><Typography.Text type='tertiary'>{t('每日低保领取上限')}</Typography.Text><div className='text-xl font-semibold mt-1'>{renderQuota(status.welfare_daily_grant || 0)}</div></Card>
          </div>
          <Typography.Text>
            {t('当前余额')}: {renderQuota(status.balance || 0)}
          </Typography.Text>
          <Button
            size='large'
            theme='solid'
            type='warning'
            loading={claiming}
            disabled={!status.welfare_eligible || claiming}
            onClick={claim}
          >
            {status.welfare_claimed_today
              ? t('今日已领取')
              : status.welfare_pool <= 0
                ? t('低保池暂无额度')
                : status.balance >= status.welfare_balance_threshold
                  ? t('余额未低于领取线')
                  : t('领取今日低保')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default DiceWelfare;
