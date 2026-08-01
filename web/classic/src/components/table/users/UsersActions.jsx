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

import React, { useRef, useState } from 'react';
import {
  Button,
  Modal,
  Dropdown,
  Form,
  Typography,
} from '@douyinfe/semi-ui';
import { IconChevronDown } from '@douyinfe/semi-icons';
import {
  getCurrencyConfig,
  renderQuota,
} from '../../../helpers';
import {
  displayAmountToQuota,
  quotaToDisplayAmount,
} from '../../../helpers/quota';

const UsersActions = ({
  setShowAddUser,
  batchDeregisterDisabled,
  batchAdjustQuotaByBalance,
  purgeDeregistered,
  t,
}) => {
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustLoading, setAdjustLoading] = useState(false);
  // useAmount=true 用金额（美元/货币）输入，false 用原生额度输入
  const [useAmount, setUseAmount] = useState(true);
  const adjustFormApi = useRef();

  // Add new user
  const handleAddUser = () => {
    setShowAddUser(true);
  };

  const handleBatchDeregister = (excludeViolation) => {
    Modal.confirm({
      title: t('一键注销已禁用用户'),
      content: excludeViolation
        ? t(
            '将把所有「已禁用」状态的用户注销（软删除），但会跳过违规榜上的用户，使其保持被封禁状态。User ID 1 和管理员也会被跳过。此操作不可撤销，确定继续？',
          )
        : t(
            '将把所有「已禁用」状态的用户注销（软删除），User ID 1 和管理员会被跳过。此操作不可撤销，确定继续？',
          ),
      okText: t('确认注销'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: () => batchDeregisterDisabled(excludeViolation),
    });
  };

  const handlePurgeDeregistered = () => {
    Modal.confirm({
      title: t('彻底清理已注销用户'),
      content: t(
        '将从数据库中永久删除所有「已注销」用户及其数据，无法恢复。确定继续？',
      ),
      okText: t('确认清理'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: () => purgeDeregistered(),
    });
  };

  // 打开批量调整额度弹窗
  const openAdjustModal = () => {
    setShowAdjustModal(true);
    setTimeout(() => {
      adjustFormApi.current?.setValues({
        minAmount: 0,
        maxAmount: 0,
        deltaAmount: 0,
        minQuota: 0,
        maxQuota: 0,
        deltaQuota: 0,
        direction: 'increase',
      });
    }, 0);
  };

  // 提交批量调整额度
  const handleAdjustSubmit = async () => {
    const values = adjustFormApi.current?.getValues() || {};
    let minQuota;
    let maxQuota;
    let absDelta;
    if (useAmount) {
      minQuota = displayAmountToQuota(values.minAmount || 0);
      maxQuota = displayAmountToQuota(values.maxAmount || 0);
      absDelta = Math.abs(displayAmountToQuota(values.deltaAmount || 0));
    } else {
      minQuota = Math.round(values.minQuota || 0);
      maxQuota = Math.round(values.maxQuota || 0);
      absDelta = Math.abs(Math.round(values.deltaQuota || 0));
    }
    if (minQuota < 0 || maxQuota < 0 || minQuota > maxQuota) {
      Modal.error({ title: t('请正确设置余额区间') });
      return;
    }
    if (!absDelta) {
      Modal.error({ title: t('请输入调整额度') });
      return;
    }
    const delta = values.direction === 'decrease' ? -absDelta : absDelta;
    const actionText =
      values.direction === 'decrease' ? t('减少') : t('增加');

    Modal.confirm({
      title: t('确认批量调整额度'),
      content: t(
        '将对余额在 {{min}} ~ {{max}} 区间内的所有用户{{action}} {{delta}} 额度（跳过 User ID 1 和管理员）。此操作不可撤销，确定继续？',
        {
          min: renderQuota(minQuota),
          max: renderQuota(maxQuota),
          action: actionText,
          delta: renderQuota(absDelta),
        },
      ),
      okText: t('确认调整'),
      cancelText: t('取消'),
      okType: 'warning',
      centered: true,
      onOk: async () => {
        setAdjustLoading(true);
        try {
          const ok = await batchAdjustQuotaByBalance({
            minQuota,
            maxQuota,
            delta,
          });
          if (ok) setShowAdjustModal(false);
        } finally {
          setAdjustLoading(false);
        }
      },
    });
  };

  const currencySymbol = getCurrencyConfig().symbol;

  return (
    <div className='flex gap-2 w-full md:w-auto order-2 md:order-1'>
      <Button className='w-full md:w-auto' onClick={handleAddUser} size='small'>
        {t('添加用户')}
      </Button>
      <Dropdown
        trigger='click'
        position='bottomLeft'
        menu={[
          {
            node: 'item',
            name: t('注销全部已禁用用户'),
            onClick: () => handleBatchDeregister(false),
          },
          {
            node: 'item',
            name: t('注销时排除违规榜用户'),
            onClick: () => handleBatchDeregister(true),
          },
        ]}
      >
        <Button
          type='danger'
          className='w-full md:w-auto'
          size='small'
          icon={<IconChevronDown />}
          iconPosition='right'
        >
          {t('注销已禁用用户')}
        </Button>
      </Dropdown>
      <Button
        type='danger'
        className='w-full md:w-auto'
        onClick={handlePurgeDeregistered}
        size='small'
      >
        {t('清理已注销用户')}
      </Button>
      <Button
        type='secondary'
        className='w-full md:w-auto'
        onClick={openAdjustModal}
        size='small'
      >
        {t('按余额批量调额')}
      </Button>

      <Modal
        title={t('按余额区间批量加/减额度')}
        visible={showAdjustModal}
        onCancel={() => setShowAdjustModal(false)}
        onOk={handleAdjustSubmit}
        okText={t('调整')}
        cancelText={t('取消')}
        confirmLoading={adjustLoading}
        centered
      >
        <Typography.Text type='tertiary' size='small'>
          {t(
            '对「当前余额」落在指定区间内的用户批量加/减额度。跳过 User ID 1 和管理员，减额时扣至 0 为止。',
          )}
        </Typography.Text>
        <div
          className='text-xs cursor-pointer mt-2 mb-1'
          style={{ color: 'var(--semi-color-link)' }}
          onClick={() => setUseAmount((v) => !v)}
        >
          {useAmount
            ? `▸ ${t('切换为原生额度输入')}`
            : `▾ ${t('切换为金额输入')}`}
        </div>
        <Form getFormApi={(api) => (adjustFormApi.current = api)}>
          {useAmount ? (
            <>
              <Form.InputNumber
                field='minAmount'
                label={`${t('余额区间下限')}（${currencySymbol}）`}
                prefix={currencySymbol}
                min={0}
                step={0.01}
                precision={6}
                style={{ width: '100%' }}
              />
              <Form.InputNumber
                field='maxAmount'
                label={`${t('余额区间上限')}（${currencySymbol}）`}
                prefix={currencySymbol}
                min={0}
                step={0.01}
                precision={6}
                style={{ width: '100%' }}
              />
              <Form.InputNumber
                field='deltaAmount'
                label={`${t('调整额度')}（${currencySymbol}）`}
                prefix={currencySymbol}
                min={0}
                step={0.01}
                precision={6}
                style={{ width: '100%' }}
              />
            </>
          ) : (
            <>
              <Form.InputNumber
                field='minQuota'
                label={t('余额区间下限（原生额度）')}
                min={0}
                style={{ width: '100%' }}
              />
              <Form.InputNumber
                field='maxQuota'
                label={t('余额区间上限（原生额度）')}
                min={0}
                style={{ width: '100%' }}
              />
              <Form.InputNumber
                field='deltaQuota'
                label={t('调整额度（原生额度）')}
                min={0}
                style={{ width: '100%' }}
              />
            </>
          )}
          <Form.RadioGroup field='direction' label={t('调整方向')} initValue='increase'>
            <Form.Radio value='increase'>{t('增加额度')}</Form.Radio>
            <Form.Radio value='decrease'>{t('减少额度')}</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersActions;
