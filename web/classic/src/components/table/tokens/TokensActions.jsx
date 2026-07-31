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

import React, { useState } from 'react';
import { Button, Space } from '@douyinfe/semi-ui';
import { showError, showSuccess, copy } from '../../../helpers';
import CopyTokensModal from './modals/CopyTokensModal';
import DeleteTokensModal from './modals/DeleteTokensModal';

const TokensActions = ({
  selectedKeys,
  setEditingToken,
  setShowEdit,
  batchCopyTokens,
  batchDeleteTokens,
  t,
}) => {
  // Modal states
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 复制 BaseURL（站点地址 + /v1，取不到则退回当前域名）
  const handleCopyBaseUrl = async () => {
    let serverAddress = '';
    try {
      const status = JSON.parse(localStorage.getItem('status') || '{}');
      serverAddress = status.server_address || '';
    } catch (_) {}
    if (!serverAddress) serverAddress = window.location.origin;
    serverAddress = serverAddress.replace(/\/+$/, '');
    const baseUrl = `${serverAddress}/v1`;
    if (await copy(baseUrl)) {
      showSuccess(`${t('已复制 BaseURL')}：${baseUrl}`);
    } else {
      showError(`${t('无法复制到剪贴板，请手动复制')}：${baseUrl}`);
    }
  };

  // Handle copy selected tokens with options
  const handleCopySelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowCopyModal(true);
  };

  // Handle delete selected tokens with confirmation
  const handleDeleteSelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowDeleteModal(true);
  };

  // Handle delete confirmation
  const handleConfirmDelete = () => {
    batchDeleteTokens();
    setShowDeleteModal(false);
  };

  return (
    <>
      <div className='flex flex-wrap gap-2 w-full md:w-auto order-2 md:order-1'>
        <Button
          type='primary'
          className='flex-1 md:flex-initial'
          onClick={() => {
            setEditingToken({
              id: undefined,
            });
            setShowEdit(true);
          }}
          size='small'
        >
          {t('添加令牌')}
        </Button>

        <Button
          type='tertiary'
          className='flex-1 md:flex-initial'
          onClick={handleCopySelectedTokens}
          size='small'
        >
          {t('复制所选令牌')}
        </Button>

        <Button
          type='tertiary'
          className='flex-1 md:flex-initial'
          onClick={handleCopyBaseUrl}
          size='small'
        >
          {t('复制 BaseURL')}
        </Button>

        <Button
          type='danger'
          className='w-full md:w-auto'
          onClick={handleDeleteSelectedTokens}
          size='small'
        >
          {t('删除所选令牌')}
        </Button>
      </div>

      <CopyTokensModal
        visible={showCopyModal}
        onCancel={() => setShowCopyModal(false)}
        batchCopyTokens={batchCopyTokens}
        t={t}
      />

      <DeleteTokensModal
        visible={showDeleteModal}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        selectedKeys={selectedKeys}
        t={t}
      />
    </>
  );
};

export default TokensActions;
