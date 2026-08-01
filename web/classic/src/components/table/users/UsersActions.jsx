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

import React from 'react';
import { Button, Modal, Dropdown } from '@douyinfe/semi-ui';
import { IconChevronDown } from '@douyinfe/semi-icons';

const UsersActions = ({
  setShowAddUser,
  batchDeregisterDisabled,
  purgeDeregistered,
  t,
}) => {
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
    </div>
  );
};

export default UsersActions;
