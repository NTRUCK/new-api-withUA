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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  TabPane,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';

const { Title, Text, Paragraph } = Typography;

const TICKET_KEY = 'audit_panel_ticket';

// 带面板票据的请求封装
const auditHeaders = () => ({
  'X-Audit-Ticket': localStorage.getItem(TICKET_KEY) || '',
});
const auditGet = (url) => API.get(url, { headers: auditHeaders() });
const auditPut = (url, data) =>
  API.put(url, data, { headers: auditHeaders() });

// 从请求体 JSON 中提取 messages 用于结构化展示
const parseRequestMessages = (body) => {
  if (!body) return null;
  try {
    const obj = JSON.parse(body);
    if (Array.isArray(obj.messages)) {
      return { model: obj.model, messages: obj.messages, stream: obj.stream };
    }
    // Responses API / Gemini 原生格式兜底
    if (Array.isArray(obj.input)) {
      return { model: obj.model, messages: obj.input, stream: obj.stream };
    }
    if (Array.isArray(obj.contents)) {
      return { model: obj.model, messages: obj.contents, stream: obj.stream };
    }
    return null;
  } catch (e) {
    return null;
  }
};

// 从响应体尾部提取助手文本（后端附加 assistant_text 段）
const parseAssistantText = (body) => {
  if (!body) return '';
  const marker = '----- assistant_text -----';
  const idx = body.indexOf(marker);
  if (idx >= 0) return body.slice(idx + marker.length).trim();
  return '';
};

const ContentAudit = () => {
  const [authed, setAuthed] = useState(
    Boolean(localStorage.getItem(TICKET_KEY)),
  );
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [passwordSet, setPasswordSet] = useState(true);

  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState('users');

  const loadConfig = async () => {
    try {
      const res = await auditGet('/api/audit_panel/config');
      const { success, data } = res.data;
      if (success) {
        setConfig(data);
        setPasswordSet(Boolean(data.password_set));
      }
    } catch (e) {
      // 忽略首屏配置读取失败
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleLogin = async () => {
    if (!password.trim()) return showError('请输入面板密码');
    setLoginLoading(true);
    try {
      const res = await API.post('/api/audit_panel/login', {
        password: password.trim(),
      });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message || '登录失败');
        return;
      }
      localStorage.setItem(TICKET_KEY, data.ticket);
      setAuthed(true);
      setPassword('');
      showSuccess('已进入审计面板');
      loadUsers();
    } catch (e) {
      showError(e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TICKET_KEY);
    setAuthed(false);
    setUsers([]);
    setSessions([]);
    setLogs([]);
    setCurrentUser(null);
    setCurrentSession(null);
  };

  const handleAuthExpired = (message) => {
    if (message && message.includes('凭证无效')) {
      handleLogout();
      return true;
    }
    return false;
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await auditGet('/api/audit_panel/users');
      const { success, message, data } = res.data;
      if (!success) {
        if (!handleAuthExpired(message)) showError(message);
        return;
      }
      setUsers(data || []);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (authed) {
      loadUsers();
      loadConfig();
    }
  }, [authed]);

  const handleSelectUser = async (user) => {
    setCurrentUser(user);
    setCurrentSession(null);
    setLogs([]);
    // 会话列表与用户列表同处「按用户」标签页，无需切换 tab
    setActiveTab('users');
    setLoadingSessions(true);
    try {
      const res = await auditGet(
        `/api/audit_panel/sessions?user_id=${user.user_id}&limit=200`,
      );
      const { success, message, data } = res.data;
      if (!success) {
        if (!handleAuthExpired(message)) showError(message);
        return;
      }
      setSessions(data || []);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSelectSession = async (session) => {
    setCurrentSession(session);
    setActiveTab('detail');
    setLoadingLogs(true);
    try {
      const res = await auditGet(
        `/api/audit_panel/session?session_id=${encodeURIComponent(
          session.session_id,
        )}&limit=300`,
      );
      const { success, message, data } = res.data;
      if (!success) {
        if (!handleAuthExpired(message)) showError(message);
        return;
      }
      setLogs(data || []);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleSaveConfig = async (patch) => {
    setSaving(true);
    try {
      const res = await auditPut('/api/audit_panel/config', patch);
      const { success, message } = res.data;
      if (!success) {
        if (!handleAuthExpired(message)) showError(message);
        return;
      }
      showSuccess('已保存');
      loadConfig();
    } catch (e) {
      showError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // 会话详情渲染：把每次请求的 messages 与助手回复按轮次展示
  const renderConversation = useMemo(() => {
    if (!logs.length) {
      return <Empty title='该会话暂无记录' />;
    }
    return logs.map((item, idx) => {
      const parsed = parseRequestMessages(item.request_body);
      const assistantText = parseAssistantText(item.response_body);
      const messages = parsed?.messages || [];
      // 只显示最后一条 user 消息作为本轮输入（历史消息在上一轮已展示）
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      return (
        <Card
          key={item.id}
          style={{ marginBottom: 16 }}
          headerExtraContent={
            <Text type='tertiary'>
              #{idx + 1} · {timestamp2string(item.created_at)}
            </Text>
          }
          title={
            <div>
              <Tag color='blue'>{item.model_name || '-'}</Tag>
              <Tag color='grey' style={{ marginLeft: 8 }}>
                {item.token_name || '-'}
              </Tag>
              <Tag color='light-blue' style={{ marginLeft: 8 }}>
                {item.status_code}
              </Tag>
            </div>
          }
        >
          <div style={{ marginBottom: 8 }}>
            <Text type='tertiary'>
              UA: {item.user_agent || '-'} ｜ IP: {item.client_ip || '-'} ｜
              耗时 {item.duration_ms || 0}ms
            </Text>
          </div>
          {messages.length > 0 ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <Text strong>本轮输入</Text>
                <Paragraph
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: 'var(--semi-color-fill-0)',
                    padding: 12,
                    borderRadius: 6,
                    maxHeight: 320,
                    overflow: 'auto',
                  }}
                >
                  {typeof lastUser?.content === 'string'
                    ? lastUser.content
                    : JSON.stringify(lastUser?.content, null, 2)}
                </Paragraph>
              </div>
              <details style={{ marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer' }}>
                  完整请求（{messages.length} 条消息）
                </summary>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 360,
                    overflow: 'auto',
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(messages, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer' }}>原始请求体</summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 360,
                  overflow: 'auto',
                  fontSize: 12,
                }}
              >
                {item.request_body || '(空)'}
              </pre>
            </details>
          )}
          <div>
            <Text strong>AI 回复</Text>
            <Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--semi-color-success-light-default)',
                padding: 12,
                borderRadius: 6,
                maxHeight: 480,
                overflow: 'auto',
              }}
            >
              {assistantText || '(未能解析出文本，见下方原始响应)'}
            </Paragraph>
          </div>
          <details>
            <summary style={{ cursor: 'pointer' }}>原始响应体</summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 360,
                overflow: 'auto',
                fontSize: 12,
              }}
            >
              {item.response_body || '(空)'}
            </pre>
          </details>
        </Card>
      );
    });
  }, [logs]);

  // 未登录：密码门
  if (!authed) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: '80px auto' }}>
        <Card>
          <Title heading={4}>内容审计面板</Title>
          <Paragraph type='tertiary' style={{ marginBottom: 16 }}>
            该面板可查看全部用户的请求与 AI 回复原文，需独立密码访问。
          </Paragraph>
          {!passwordSet && (
            <Paragraph type='warning' style={{ marginBottom: 12 }}>
              尚未设置面板密码，面板暂不可用。请联系站长完成初始化。
            </Paragraph>
          )}
          <Input
            mode='password'
            placeholder='面板密码'
            value={password}
            onChange={setPassword}
            onEnterPress={handleLogin}
            style={{ marginBottom: 12 }}
          />
          <Button
            theme='solid'
            type='primary'
            block
            loading={loginLoading}
            onClick={handleLogin}
          >
            进入
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Title heading={4} style={{ margin: 0 }}>
          内容审计面板
        </Title>
        <div>
          <Button
            theme='borderless'
            onClick={() => {
              loadUsers();
              loadConfig();
            }}
          >
            刷新
          </Button>
          <Button theme='borderless' type='danger' onClick={handleLogout}>
            退出
          </Button>
        </div>
      </div>

      {config?.over_capacity && (
        <Card style={{ marginBottom: 12, background: 'var(--semi-color-danger-light-default)' }}>
          <Text type='danger' strong>
            审计表已达容量上限（{config.table_size_mb}MB /{' '}
            {config.max_table_mb}MB），当前已暂停记录。请调大上限或缩短保留天数。
          </Text>
        </Card>
      )}

      <Tabs activeKey={activeTab} onChange={setActiveTab} type='line'>
        <TabPane tab='按用户' itemKey='users'>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <Card
              style={{ width: 320, flexShrink: 0 }}
              title='用户列表'
              headerExtraContent={
                <Text type='tertiary'>{users.length} 人</Text>
              }
            >
              <Spin spinning={loadingUsers}>
                {users.length === 0 ? (
                  <Empty title='暂无审计记录' />
                ) : (
                  users.map((u) => (
                    <div
                      key={u.user_id}
                      onClick={() => handleSelectUser(u)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background:
                          currentUser?.user_id === u.user_id
                            ? 'var(--semi-color-primary-light-default)'
                            : 'transparent',
                        marginBottom: 4,
                      }}
                    >
                      <div>
                        <Text strong>{u.username || `用户 #${u.user_id}`}</Text>
                        <Tag size='small' style={{ marginLeft: 8 }}>
                          {u.reqs} 请求
                        </Tag>
                      </div>
                      <Text type='tertiary' size='small'>
                        最近 {timestamp2string(u.last_at)}
                      </Text>
                    </div>
                  ))
                )}
              </Spin>
            </Card>

            <Card style={{ flex: 1 }} title='会话列表'>
              {!currentUser ? (
                <Empty title='请选择左侧用户' />
              ) : (
                <Spin spinning={loadingSessions}>
                  {sessions.length === 0 ? (
                    <Empty title='该用户暂无会话' />
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.session_id}
                        onClick={() => handleSelectSession(s)}
                        style={{
                          padding: '10px 12px',
                          border: '1px solid var(--semi-color-border)',
                          borderRadius: 6,
                          cursor: 'pointer',
                          marginBottom: 8,
                          background:
                            currentSession?.session_id === s.session_id
                              ? 'var(--semi-color-primary-light-default)'
                              : 'transparent',
                        }}
                      >
                        <div style={{ marginBottom: 4 }}>
                          <Tag color='blue'>{s.model_name || '-'}</Tag>
                          <Tag color='grey' style={{ marginLeft: 6 }}>
                            {s.token_name || '-'}
                          </Tag>
                          <Tag color='light-green' style={{ marginLeft: 6 }}>
                            {s.reqs} 轮
                          </Tag>
                          <Text type='tertiary' size='small' style={{ marginLeft: 8 }}>
                            {timestamp2string(s.start_at)} ~{' '}
                            {timestamp2string(s.end_at)}
                          </Text>
                        </div>
                        <Text
                          type='tertiary'
                          size='small'
                          style={{ wordBreak: 'break-all' }}
                        >
                          UA: {s.user_agent || '-'}
                        </Text>
                      </div>
                    ))
                  )}
                </Spin>
              )}
            </Card>
          </div>
        </TabPane>

        <TabPane tab='对话详情' itemKey='detail'>
          {!currentSession ? (
            <Empty title='请先在「按用户」中选择一个会话' />
          ) : (
            <Spin spinning={loadingLogs}>
              <Card
                style={{ marginBottom: 12 }}
                title={`会话 ${currentSession.session_id}`}
                headerExtraContent={
                  <Text type='tertiary'>
                    {currentSession.reqs} 轮 · UA{' '}
                    {currentSession.user_agent || '-'}
                  </Text>
                }
              >
                <Text type='tertiary'>
                  模型 {currentSession.model_name || '-'} ｜ 令牌{' '}
                  {currentSession.token_name || '-'}
                </Text>
              </Card>
              {renderConversation}
            </Spin>
          )}
        </TabPane>

        <TabPane tab='设置' itemKey='settings'>
          {config && (
            <Card style={{ maxWidth: 720 }}>
              <div style={{ marginBottom: 16 }}>
                <Text strong>启用内容审计</Text>
                <div style={{ marginTop: 6 }}>
                  <Switch
                    checked={config.enabled}
                    onChange={(v) => {
                      setConfig({ ...config, enabled: v });
                      handleSaveConfig({ enabled: v });
                    }}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>记录范围</Text>
                <div style={{ marginTop: 6 }}>
                  <Select
                    value={config.mode || 'whitelist'}
                    onChange={(v) => {
                      setConfig({ ...config, mode: v });
                      handleSaveConfig({ mode: v });
                    }}
                    style={{ width: 320 }}
                    optionList={[
                      { label: '白名单（指定用户/分组）', value: 'whitelist' },
                      { label: '全部用户', value: 'all' },
                    ]}
                  />
                </div>
                <Text type='tertiary' size='small'>
                  全部用户模式会产生较大存储，请配合保留天数与容量上限使用。
                </Text>
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>白名单用户 ID（逗号分隔）</Text>
                <Input
                  defaultValue={config.user_ids}
                  onBlur={(e) =>
                    handleSaveConfig({ user_ids: e.target.value.trim() })
                  }
                  placeholder='例如：6012,616'
                  style={{ marginTop: 6 }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>白名单分组（逗号分隔）</Text>
                <Input
                  defaultValue={config.groups}
                  onBlur={(e) =>
                    handleSaveConfig({ groups: e.target.value.trim() })
                  }
                  placeholder='例如：default,tavern'
                  style={{ marginTop: 6 }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>保留天数</Text>
                <div style={{ marginTop: 6 }}>
                  <InputNumber
                    value={config.keep_days}
                    min={1}
                    max={365}
                    onChange={(v) => setConfig({ ...config, keep_days: v })}
                    style={{ width: 160 }}
                  />
                  <Button
                    style={{ marginLeft: 8 }}
                    onClick={() => handleSaveConfig({ keep_days: config.keep_days })}
                  >
                    保存
                  </Button>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>会话切分间隔（分钟）</Text>
                <div style={{ marginTop: 6 }}>
                  <InputNumber
                    value={config.session_gap_minutes}
                    min={1}
                    max={1440}
                    onChange={(v) =>
                      setConfig({ ...config, session_gap_minutes: v })
                    }
                    style={{ width: 160 }}
                  />
                  <Button
                    style={{ marginLeft: 8 }}
                    onClick={() =>
                      handleSaveConfig({
                        session_gap_minutes: config.session_gap_minutes,
                      })
                    }
                  >
                    保存
                  </Button>
                </div>
                <Text type='tertiary' size='small'>
                  同一令牌、同一 UA 在间隔内的连续请求归为同一会话。
                </Text>
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>单条内容上限（字节）</Text>
                <div style={{ marginTop: 6 }}>
                  <InputNumber
                    value={config.max_body_bytes}
                    min={1024}
                    max={4194304}
                    step={1024}
                    onChange={(v) =>
                      setConfig({ ...config, max_body_bytes: v })
                    }
                    style={{ width: 200 }}
                  />
                  <Button
                    style={{ marginLeft: 8 }}
                    onClick={() =>
                      handleSaveConfig({ max_body_bytes: config.max_body_bytes })
                    }
                  >
                    保存
                  </Button>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>审计表容量上限（MB）</Text>
                <div style={{ marginTop: 6 }}>
                  <InputNumber
                    value={config.max_table_mb}
                    min={128}
                    max={102400}
                    onChange={(v) => setConfig({ ...config, max_table_mb: v })}
                    style={{ width: 200 }}
                  />
                  <Button
                    style={{ marginLeft: 8 }}
                    onClick={() =>
                      handleSaveConfig({ max_table_mb: config.max_table_mb })
                    }
                  >
                    保存
                  </Button>
                </div>
                <Text type='tertiary' size='small'>
                  当前占用 {config.table_size_mb}MB；超过上限将暂停记录。
                </Text>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text strong>修改面板密码</Text>
                <NewPasswordInput onSave={(v) => handleSaveConfig({ new_password: v })} />
              </div>
            </Card>
          )}
        </TabPane>
      </Tabs>
    </div>
  );
};

// 修改面板密码（独立组件以管理输入态）
const NewPasswordInput = ({ onSave }) => {
  const [value, setValue] = useState('');
  return (
    <div style={{ marginTop: 6 }}>
      <Input
        mode='password'
        value={value}
        onChange={setValue}
        placeholder='输入新密码（至少 6 位）'
        style={{ width: 280 }}
      />
      <Button
        style={{ marginLeft: 8 }}
        onClick={() => {
          if (value.trim().length < 6) return showError('密码至少 6 位');
          onSave(value.trim());
          setValue('');
        }}
      >
        更新密码
      </Button>
    </div>
  );
};

export default ContentAudit;
