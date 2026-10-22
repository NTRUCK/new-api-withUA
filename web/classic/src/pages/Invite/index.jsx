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
import { Spin } from '@douyinfe/semi-ui';
import { API } from '../../helpers';
import StatusQuery from '../../components/invite/StatusQuery';
import ReviewTable from '../../components/invite/ReviewTable';

/**
 * 注册审核页面 /invite。
 *
 * 双角色：
 *   - 申请人（尚未有账号，通常未登录）：查询自己的审核进度
 *   - 审查员（管理员或审核员白名单）：查看申请列表并审批
 *
 * 角色由后端 /api/user_review/summary 判定，前端仅据此切换视图。
 */
const Invite = () => {
  const [loading, setLoading] = useState(true);
  const [canReview, setCanReview] = useState(false);

  useEffect(() => {
    const checkRole = async () => {
      // 未登录时不请求，避免 401 触发跳转登录页
      if (!localStorage.getItem('user')) {
        setLoading(false);
        return;
      }
      try {
        const res = await API.get('/api/user_review/summary');
        const { success, data } = res.data;
        if (success && data?.can_review) {
          setCanReview(true);
        }
      } catch (error) {
        // 接口不可用时降级为申请人视图
      } finally {
        setLoading(false);
      }
    };
    checkRole();
  }, []);

  if (loading) {
    return (
      <div className='mt-[60px] px-2 flex justify-center py-20'>
        <Spin />
      </div>
    );
  }

  return (
    <div className='mt-[60px] px-2'>
      <div className={canReview ? 'max-w-6xl mx-auto' : 'max-w-xl mx-auto'}>
        {canReview ? <ReviewTable /> : <StatusQuery />}
      </div>
    </div>
  );
};

export default Invite;
