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
import { Button, Modal } from '@douyinfe/semi-ui';

const UsersActions = ({ setShowAddUser, batchDeregisterDisabled, t }) => {
  // Add new user
  const handleAddUser = () => {
    setShowAddUser(true);
  };

  const handleBatchDeregister = () => {
    Modal.confirm({
      title: t('一键注销已禁用用户'),
      content: t(
        '将把所有「已禁用」状态的用户注销（软删除），User ID 1 和管理员会被跳过。此操作不可撤销，确定继续？',
      ),
      okText: t('确认注销'),
      cancelText: t('取消'),
      okType: 'danger',
      centered: true,
      onOk: () => batchDeregisterDisabled(),
    });
  };

  return (
    <div className='flex gap-2 w-full md:w-auto order-2 md:order-1'>
      <Button className='w-full md:w-auto' onClick={handleAddUser} size='small'>
        {t('添加用户')}
      </Button>
      <Button
        type='danger'
        className='w-full md:w-auto'
        onClick={handleBatchDeregister}
        size='small'
      >
        {t('注销已禁用用户')}
      </Button>
    </div>
  );
};

export default UsersActions;
