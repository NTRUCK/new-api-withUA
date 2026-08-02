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
import { Modal, Radio, RadioGroup, TextArea, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../../helpers';

const { Text } = Typography;

// 模型问题反馈弹窗：用户从模型卡片触发，汇报模型问题
const ModelFeedbackModal = ({ visible, onClose, modelName, t }) => {
  const [reasonCode, setReasonCode] = useState('unavailable');
  const [reasonText, setReasonText] = useState('');
  const [loading, setLoading] = useState(false);

  const reasonOptions = [
    { value: 'fake', label: t('挂羊头卖狗肉（假模型）') },
    { value: 'unavailable', label: t('不可用') },
    { value: 'watered', label: t('疑似掺水/降智') },
    { value: 'other', label: t('其他问题') },
  ];

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await API.post('/api/model_feedback', {
        model_name: modelName,
        reason_code: reasonCode,
        reason_text: reasonText,
      });
      if (res?.data?.success) {
        showSuccess(t('反馈已提交，感谢你的反馈'));
        setReasonText('');
        setReasonCode('unavailable');
        onClose();
      } else {
        showError(res?.data?.message || t('提交失败'));
      }
    } catch (e) {
      showError(e?.response?.data?.message || t('提交失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('反馈模型问题')}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={t('提交反馈')}
      cancelText={t('取消')}
      confirmLoading={loading}
      maskClosable={false}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type='tertiary'>{t('模型：')}</Text>
        <Text strong>{modelName}</Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text type='tertiary' style={{ display: 'block', marginBottom: 6 }}>
          {t('问题类型')}
        </Text>
        <RadioGroup
          direction='vertical'
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          {reasonOptions.map((opt) => (
            <Radio key={opt.value} value={opt.value}>
              {opt.label}
            </Radio>
          ))}
        </RadioGroup>
      </div>
      <div>
        <Text type='tertiary' style={{ display: 'block', marginBottom: 6 }}>
          {t('补充说明（可选）')}
        </Text>
        <TextArea
          value={reasonText}
          onChange={setReasonText}
          maxCount={500}
          maxLength={500}
          autosize={{ minRows: 3, maxRows: 6 }}
          placeholder={t('可描述具体现象，如报错信息、异常表现等')}
        />
      </div>
    </Modal>
  );
};

export default ModelFeedbackModal;
