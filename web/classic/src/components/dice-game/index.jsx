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
  Card,
  Button,
  InputNumber,
  Typography,
  Tag,
  Empty,
  Spin,
  Table,
  Banner,
} from '@douyinfe/semi-ui';
import {
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, renderQuota } from '../../helpers';
import { timestamp2string } from '../../helpers/utils';

const DICE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

const DiceFace = ({ value, rolling }) => {
  const Icon = DICE_ICONS[(value || 1) - 1] || Dice1;
  return (
    <Icon
      size={48}
      className={rolling ? 'animate-spin text-semi-color-primary' : 'text-semi-color-primary'}
    />
  );
};

const DiceGamePanel = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bet, setBet] = useState(1000);
  const [choice, setChoice] = useState('big');
  const [playing, setPlaying] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/user/dice_game');
      const { success, message, data } = res.data;
      if (!success) return showError(message);
      setStatus(data);
      setBet((prev) => {
        const v = prev || data.min_bet;
        return Math.min(Math.max(v, data.min_bet), data.max_bet);
      });
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const play = async () => {
    if (!status) return;
    if (bet < status.min_bet || bet > status.max_bet) {
      return showError(
        t('下注额度需在 {{min}} ~ {{max}} 之间', {
          min: renderQuota(status.min_bet),
          max: renderQuota(status.max_bet),
        }),
      );
    }
    setPlaying(true);
    setRolling(true);
    try {
      const res = await API.post('/api/user/dice_game', { choice, bet });
      const { success, message, data } = res.data;
      if (!success) {
        setRolling(false);
        return showError(message);
      }
      // 骰子动画后再展示结果
      setTimeout(() => {
        setRolling(false);
        setLastResult(data);
        if (data.win) {
          showSuccess(
            t('赢了！净得 {{quota}}', { quota: renderQuota(data.net_change) }),
          );
        } else {
          showError(
            t('输了，净损 {{quota}}', {
              quota: renderQuota(Math.abs(data.net_change)),
            }),
          );
        }
        loadStatus();
      }, 700);
    } catch (e) {
      setRolling(false);
      showError(e.message);
    } finally {
      setPlaying(false);
    }
  };

  if (loading && !status) {
    return (
      <Card>
        <Spin spinning style={{ width: '100%' }}>
          <div style={{ height: 200 }} />
        </Spin>
      </Card>
    );
  }

  if (status && !status.enabled) {
    return (
      <Card>
        <Empty description={t('小游戏功能未启用')} />
      </Card>
    );
  }

  const displayDice = lastResult ? lastResult.dice : [1, 1, 1];
  const reachedLimit =
    status &&
    status.daily_max_plays > 0 &&
    status.plays_today >= status.daily_max_plays;

  const recordColumns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      render: (ts) => timestamp2string(ts),
    },
    {
      title: t('下注'),
      dataIndex: 'choice',
      render: (c) => (
        <Tag color={c === 'big' ? 'red' : 'blue'} shape='circle'>
          {c === 'big' ? t('大') : t('小')}
        </Tag>
      ),
    },
    {
      title: t('点数'),
      dataIndex: 'sum',
      render: (sum, r) => (
        <span>
          {r.dice1}+{r.dice2}+{r.dice3}={sum}
          {r.is_triple && (
            <Tag color='amber' size='small' className='ml-1'>
              {t('豹子')}
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: t('金额'),
      dataIndex: 'bet',
      render: (v) => renderQuota(v),
    },
    {
      title: t('结果'),
      dataIndex: 'net_change',
      render: (v, r) => (
        <Typography.Text type={r.win ? 'success' : 'danger'}>
          {r.win ? '+' : ''}
          {renderQuota(v)}
        </Typography.Text>
      ),
    },
  ];

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <div className='flex flex-col items-center gap-4 py-4'>
          <Typography.Title heading={4} className='!mb-0'>
            {t('幸运骰子 · 猜大小')}
          </Typography.Title>
          <Typography.Text type='tertiary' className='text-center'>
            {t('三颗骰子求和，11-18 为大，3-10 为小；出现豹子（三颗相同）庄家通吃')}
          </Typography.Text>

          <div className='flex gap-4 my-2'>
            <DiceFace value={displayDice[0]} rolling={rolling} />
            <DiceFace value={displayDice[1]} rolling={rolling} />
            <DiceFace value={displayDice[2]} rolling={rolling} />
          </div>

          {lastResult && !rolling && (
            <Banner
              type={lastResult.win ? 'success' : 'danger'}
              fullMode={false}
              closeIcon={null}
              description={
                lastResult.is_triple
                  ? t('豹子 {{a}}{{b}}{{c}}，庄家通吃', {
                      a: lastResult.dice[0],
                      b: lastResult.dice[1],
                      c: lastResult.dice[2],
                    })
                  : t('点数合计 {{sum}}（{{bs}}），本局{{result}} {{quota}}', {
                      sum: lastResult.sum,
                      bs: lastResult.sum >= 11 ? t('大') : t('小'),
                      result: lastResult.win ? t('净得') : t('净损'),
                      quota: renderQuota(Math.abs(lastResult.net_change)),
                    })
              }
            />
          )}

          <div className='flex gap-3'>
            <Button
              size='large'
              theme={choice === 'big' ? 'solid' : 'light'}
              type='danger'
              onClick={() => setChoice('big')}
            >
              {t('押大')} (11-18)
            </Button>
            <Button
              size='large'
              theme={choice === 'small' ? 'solid' : 'light'}
              type='primary'
              onClick={() => setChoice('small')}
            >
              {t('押小')} (3-10)
            </Button>
          </div>

          <div className='flex items-center gap-2'>
            <Typography.Text>{t('下注额度')}:</Typography.Text>
            <InputNumber
              value={bet}
              min={status?.min_bet}
              max={status?.max_bet}
              step={status?.min_bet}
              onChange={(v) => setBet(v)}
              style={{ width: 160 }}
            />
          </div>

          <Button
            size='large'
            theme='solid'
            loading={playing || rolling}
            disabled={reachedLimit}
            onClick={play}
          >
            {reachedLimit ? t('今日次数已用完') : t('掷骰子')}
          </Button>

          {status && (
            <div className='flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm'>
              <Typography.Text type='tertiary'>
                {t('赔率')}: {status.payout_rate}x
              </Typography.Text>
              <Typography.Text type='tertiary'>
                {t('今日已玩')}: {status.plays_today}/{status.daily_max_plays}
              </Typography.Text>
              <Typography.Text type='tertiary'>
                {t('剩余次数')}: {status.plays_left}
              </Typography.Text>
              <Typography.Text type='tertiary'>
                {t('当前余额')}: {renderQuota(status.balance)}
              </Typography.Text>
            </div>
          )}
        </div>
      </Card>

      <Card title={t('最近记录')}>
        {status?.records?.length ? (
          <Table
            columns={recordColumns}
            dataSource={status.records}
            rowKey='id'
            pagination={false}
            size='small'
          />
        ) : (
          <Empty description={t('暂无记录')} />
        )}
      </Card>
    </div>
  );
};

export default DiceGamePanel;
