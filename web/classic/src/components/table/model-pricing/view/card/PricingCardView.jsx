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
import {
  Card,
  Tag,
  Tooltip,
  Checkbox,
  Empty,
  Pagination,
  Button,
  Avatar,
} from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import { Copy, MessageSquareWarning, FlaskConical } from 'lucide-react';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import {
  stringToColor,
  calculateModelPrice,
  formatPriceInfo,
  formatDynamicPriceSummary,
  getLobeHubIcon,
  isAdmin,
} from '../../../../../helpers';
import PricingCardSkeleton from './PricingCardSkeleton';
import ModelFeedbackModal from './ModelFeedbackModal';
import ModelChannelTestModal from '../../modal/ModelChannelTestModal';
import { useMinimumLoadingTime } from '../../../../../hooks/common/useMinimumLoadingTime';
import { renderLimitedItems } from '../../../../common/ui/RenderUtils';
import { useIsMobile } from '../../../../../hooks/common/useIsMobile';

const CARD_STYLES = {
  container:
    'w-12 h-12 rounded-2xl flex items-center justify-center relative shadow-md',
  icon: 'w-8 h-8 flex items-center justify-center',
  selected: 'brand-glow-card-selected',
  default: 'border-gray-200',
};

const formatSlotHour = (hour, start, isEnd = false) =>
  String(isEnd && hour === 0 && start > 0 ? 24 : hour).padStart(2, '0');

const formatSlotRange = (slot) =>
  `${formatSlotHour(slot.start)}:00–${formatSlotHour(slot.end, slot.start, true)}:00`;

// 渲染模型在当前所选分组下的每日调用限额（已用/上限）
const renderDailyLimit = (model, selectedGroup, t) => {
  const limits = model.daily_limits;
  if (!limits || Object.keys(limits).length === 0) return null;

  let entries = Object.entries(limits);
  if (selectedGroup && selectedGroup !== 'all') {
    entries = entries.filter(([g]) => g === selectedGroup);
  }
  if (entries.length === 0) return null;

  const showGroup = !selectedGroup || selectedGroup === 'all';
  return (
    <div className='flex flex-col gap-0.5 mt-1'>
      {entries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([group, usage]) => {
          const limit = usage?.limit ?? 0;
          const used = usage?.used ?? 0;
          const resetHour = usage?.reset_hour ?? 0;
          const tiers = Array.isArray(usage?.tiers) ? usage.tiers : [];
          const slots = Array.isArray(usage?.slots) ? usage.slots : [];
          // 分时段配置：只突出当前时段，完整时段放在悬浮提示中，避免重复堆叠
          if (slots.length > 0) {
            const paused = usage?.paused;
            const currentSlot = usage?.current_slot;
            const slotSummary = slots
              .map(
                (slot) =>
                  `${formatSlotRange(slot)}  ${slot.limit === 0 ? t('停') : slot.limit.toLocaleString()}`,
              )
              .join('\n');
            return (
              <div
                key={group}
                className='flex flex-wrap items-center gap-1 text-xs'
              >
                <Tooltip content={<div className='whitespace-pre-line'>{slotSummary}</div>}>
                  <Tag size='small' color='light-blue' shape='circle'>
                    {t('分时段限额')}
                  </Tag>
                </Tooltip>
                {showGroup && (
                  <Tag size='small' color={stringToColor(group)} shape='circle'>
                    {group}
                  </Tag>
                )}
                {paused ? (
                  <Tag size='small' color='red' shape='circle'>
                    {t('当前时段暂停供应')}
                  </Tag>
                ) : (
                  currentSlot && (
                    <Tag
                      size='small'
                      color={used >= currentSlot.limit ? 'red' : 'green'}
                      shape='circle'
                    >
                      {formatSlotRange(currentSlot)} · {used.toLocaleString()}/
                      {currentSlot.limit.toLocaleString()}
                    </Tag>
                  )
                )}
              </div>
            );
          }
          const reached = used >= limit;
          return (
            <div
              key={group}
              className='flex flex-wrap items-center gap-1 text-xs'
            >
              <span style={{ color: 'var(--semi-color-text-2)' }}>
                {t('每日限额')}
              </span>
              {showGroup && (
                <Tag size='small' color={stringToColor(group)} shape='circle'>
                  {group}
                </Tag>
              )}
              <Tag
                size='small'
                color={reached ? 'red' : 'green'}
                shape='circle'
              >
                {used.toLocaleString()}/{limit.toLocaleString()}
              </Tag>
              {resetHour !== 0 && (
                <Tag size='small' color='orange' shape='circle'>
                  {t('北京时间 {{hour}}:00 刷新', {
                    hour: String(resetHour).padStart(2, '0'),
                  })}
                </Tag>
              )}
              {tiers.length > 0 && (
                <Tag size='small' color='amber' shape='circle'>
                  {t('梯度计费')}：
                  {tiers
                    .map(
                      (tier) => `${tier.from}-${tier.to} ${tier.multiplier}x`,
                    )
                    .join('，')}
                </Tag>
              )}
            </div>
          );
        })}
    </div>
  );
};

// 成功率分级配色：100% 深绿、≥90% 浅绿、≥70% 琥珀、<70% 红
const successRateColor = (rate) => {
  if (rate >= 100) return '#10b981';
  if (rate >= 90) return '#34d399';
  if (rate >= 70) return '#f59e0b';
  return '#ef4444';
};

const STATUS_SAMPLE_LIMIT = 24;

const formatLatencyText = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

const formatThroughputText = (tps) => {
  if (!Number.isFinite(tps) || tps <= 0) return '—';
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}Kt/s`;
  return `${tps.toFixed(tps < 10 ? 2 : 1)}t/s`;
};

// 渲染模型性能摘要：状态（近 1 小时成功率 + 逐小时色条）、延迟、吞吐。
// 近期没有调用时同样占位展示，用灰色状态条提示「近期无调用」。
const renderPerfMetrics = (model, t) => {
  const perf = model.perf;
  const rate =
    perf && Number.isFinite(perf.success_rate) ? perf.success_rate : null;
  const hasData = rate != null;
  const samples =
    hasData && Array.isArray(perf.recent_success_series)
      ? perf.recent_success_series
          .filter(
            (p) =>
              p &&
              Number.isFinite(p.ts) &&
              Number.isFinite(p.success_rate) &&
              p.success_rate >= 0 &&
              p.success_rate <= 100,
          )
          .sort((a, b) => a.ts - b.ts)
          .slice(-STATUS_SAMPLE_LIMIT)
      : [];

  return (
    <div
      className='flex items-center justify-between gap-3 pt-3 mt-3'
      style={{ borderTop: '1px solid var(--semi-color-border)' }}
    >
      <div className='flex items-start gap-4 text-xs'>
        <Tooltip
          content={hasData ? t('近 1 小时成功率') : t('近期无调用')}
        >
          <div style={{ width: 96 }}>
            <div
              className='flex items-center justify-between text-[11px] leading-4'
              style={{ color: 'var(--semi-color-text-2)' }}
            >
              <span>{t('状态')}</span>
              <span style={{ fontFamily: 'monospace' }}>
                {hasData ? `${rate.toFixed(2)}%` : '—'}
              </span>
            </div>
            <div
              className='mt-1 flex items-center gap-px'
              style={{ height: 12, width: 96 }}
            >
              {samples.length > 0 ? (
                samples.map((s) => (
                  <span
                    key={s.ts}
                    style={{
                      width: 3,
                      height: '100%',
                      borderRadius: 1,
                      background: successRateColor(s.success_rate),
                    }}
                  />
                ))
              ) : (
                <span
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 1,
                    background: 'var(--semi-color-fill-2)',
                  }}
                />
              )}
            </div>
          </div>
        </Tooltip>
        <div>
          <div
            className='text-[11px] leading-4'
            style={{ color: 'var(--semi-color-text-2)' }}
          >
            {t('延迟')}
          </div>
          <div className='mt-1' style={{ fontFamily: 'monospace' }}>
            {hasData ? formatLatencyText(perf.avg_latency_ms) : '—'}
          </div>
        </div>
        <div>
          <div
            className='text-[11px] leading-4'
            style={{ color: 'var(--semi-color-text-2)' }}
          >
            {t('吞吐')}
          </div>
          <div className='mt-1' style={{ fontFamily: 'monospace' }}>
            {hasData ? formatThroughputText(perf.avg_tps) : '—'}
          </div>
        </div>
      </div>
      <span
        className='text-xs shrink-0'
        style={{ color: 'var(--semi-color-text-2)' }}
      >
        {hasData ? `${t('详情')} ›` : t('近期无调用')}
      </span>
    </div>
  );
};

const PricingCardView = ({
  filteredModels,
  loading,
  rowSelection,
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  selectedGroup,
  groupRatio,
  copyText,
  setModalImageUrl,
  setIsModalOpenurl,
  currency,
  siteDisplayType,
  tokenUnit,
  displayPrice,
  showRatio,
  t,
  selectedRowKeys = [],
  setSelectedRowKeys,
  openModelDetail,
  userState,
}) => {
  const showSkeleton = useMinimumLoadingTime(loading);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedModels = filteredModels.slice(
    startIndex,
    startIndex + pageSize,
  );
  const getModelKey = (model) => model.key ?? model.model_name ?? model.id;
  const isMobile = useIsMobile();

  // 模型反馈弹窗状态
  const [feedbackModel, setFeedbackModel] = React.useState(null);
  const isLoggedIn = !!(userState && userState.user);
  // 渠道测试弹窗状态（仅管理员可见入口）
  const [testModel, setTestModel] = React.useState(null);
  const isAdminUser = isLoggedIn && isAdmin();

  const handleCheckboxChange = (model, checked) => {
    if (!setSelectedRowKeys) return;
    const modelKey = getModelKey(model);
    const newKeys = checked
      ? Array.from(new Set([...selectedRowKeys, modelKey]))
      : selectedRowKeys.filter((key) => key !== modelKey);
    setSelectedRowKeys(newKeys);
    rowSelection?.onChange?.(newKeys, null);
  };

  // 获取模型图标
  const getModelIcon = (model) => {
    if (!model || !model.model_name) {
      return (
        <div className={CARD_STYLES.container}>
          <Avatar size='large'>?</Avatar>
        </div>
      );
    }
    // 1) 优先使用模型自定义图标
    if (model.icon) {
      return (
        <div className={CARD_STYLES.container}>
          <div className={CARD_STYLES.icon}>
            {getLobeHubIcon(model.icon, 32)}
          </div>
        </div>
      );
    }
    // 2) 退化为供应商图标
    if (model.vendor_icon) {
      return (
        <div className={CARD_STYLES.container}>
          <div className={CARD_STYLES.icon}>
            {getLobeHubIcon(model.vendor_icon, 32)}
          </div>
        </div>
      );
    }

    // 如果没有供应商图标，使用模型名称生成头像

    const avatarText = model.model_name.slice(0, 2).toUpperCase();
    return (
      <div className={CARD_STYLES.container}>
        <Avatar
          size='large'
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            fontSize: 16,
            fontWeight: 'bold',
          }}
        >
          {avatarText}
        </Avatar>
      </div>
    );
  };

  // 获取模型描述
  const getModelDescription = (record) => {
    return record.description || '';
  };

  // 渲染标签
  const renderTags = (record) => {
    // 计费类型标签（左边）
    let billingTag = (
      <Tag key='billing' shape='circle' color='white' size='small'>
        -
      </Tag>
    );
    if (record.quota_type === 1) {
      billingTag = (
        <Tag key='billing' shape='circle' color='teal' size='small'>
          {t('按次计费')}
        </Tag>
      );
    } else if (record.quota_type === 0) {
      billingTag = (
        <Tag key='billing' shape='circle' color='violet' size='small'>
          {t('按量计费')}
        </Tag>
      );
    }

    // 自定义标签（右边）
    const customTags = [];
    if (record.tags) {
      const tagArr = record.tags.split(',').filter(Boolean);
      tagArr.forEach((tg, idx) => {
        customTags.push(
          <Tag
            key={`custom-${idx}`}
            shape='circle'
            color={stringToColor(tg)}
            size='small'
          >
            {tg}
          </Tag>,
        );
      });
    }

    return (
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>{billingTag}</div>
        <div className='flex items-center gap-1'>
          {customTags.length > 0 &&
            renderLimitedItems({
              items: customTags.map((tag, idx) => ({
                key: `custom-${idx}`,
                element: tag,
              })),
              renderItem: (item, idx) => item.element,
              maxDisplay: 3,
            })}
        </div>
      </div>
    );
  };

  // 显示骨架屏
  if (showSkeleton) {
    return (
      <PricingCardSkeleton
        rowSelection={!!rowSelection}
        showRatio={showRatio}
      />
    );
  }

  if (!filteredModels || filteredModels.length === 0) {
    return (
      <div className='flex justify-center items-center py-20'>
        <Empty
          image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
          }
          description={t('搜索无结果')}
        />
      </div>
    );
  }

  return (
    <div className='px-2 pt-2'>
      <div className='grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4'>
        {paginatedModels.map((model, index) => {
          const modelKey = getModelKey(model);
          const isSelected = selectedRowKeys.includes(modelKey);

          const priceData = calculateModelPrice({
            record: model,
            selectedGroup,
            groupRatio,
            tokenUnit,
            displayPrice,
            currency,
            quotaDisplayType: siteDisplayType,
          });

          return (
            <Card
              key={modelKey || index}
              className={`!rounded-2xl transition-all duration-200 border cursor-pointer brand-glow-card ${isSelected ? CARD_STYLES.selected : CARD_STYLES.default}`}
              bodyStyle={{ height: '100%' }}
              onClick={() => openModelDetail && openModelDetail(model)}
            >
              <div className='flex flex-col h-full'>
                {/* 头部：图标 + 模型名称 + 操作按钮 */}
                <div className='flex items-start justify-between mb-3'>
                  <div className='flex items-start space-x-3 flex-1 min-w-0'>
                    {getModelIcon(model)}
                    <div className='flex-1 min-w-0'>
                      <h3 className='text-lg font-bold text-gray-900 truncate'>
                        {model.model_name}
                      </h3>
                      <div className='flex flex-col gap-1 text-xs mt-1'>
                        {priceData.isDynamicPricing
                          ? formatDynamicPriceSummary(
                              priceData.billingExpr,
                              t,
                              priceData.usedGroupRatio,
                            )
                          : formatPriceInfo(priceData, t, siteDisplayType)}
                        {renderDailyLimit(model, selectedGroup, t)}
                      </div>
                    </div>
                  </div>

                  <div className='flex items-center space-x-2 ml-3'>
                    {/* 复制按钮 */}
                    <Button
                      size='small'
                      theme='outline'
                      type='tertiary'
                      icon={<Copy size={12} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyText(model.model_name);
                      }}
                    />

                    {/* 反馈按钮：仅登录用户可见 */}
                    {isLoggedIn && (
                      <Tooltip content={t('反馈模型问题')}>
                        <Button
                          size='small'
                          theme='outline'
                          type='warning'
                          icon={<MessageSquareWarning size={12} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFeedbackModel(model.model_name);
                          }}
                        />
                      </Tooltip>
                    )}

                    {/* 渠道测试按钮：仅管理员可见，按模型发起渠道测试 */}
                    {isAdminUser && (
                      <Tooltip content={t('测试渠道')}>
                        <Button
                          size='small'
                          theme='outline'
                          type='secondary'
                          icon={<FlaskConical size={12} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTestModel(model.model_name);
                          }}
                        />
                      </Tooltip>
                    )}

                    {/* 选择框 */}
                    {rowSelection && (
                      <Checkbox
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleCheckboxChange(model, e.target.checked);
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* 模型描述 - 占据剩余空间 */}
                <div className='flex-1 mb-4'>
                  <p
                    className='text-xs line-clamp-2 leading-relaxed'
                    style={{ color: 'var(--semi-color-text-2)' }}
                  >
                    {getModelDescription(model)}
                  </p>
                </div>

                {/* 底部区域 */}
                <div className='mt-auto'>
                  {/* 标签区域 */}
                  {renderTags(model)}

                  {/* 倍率信息（可选） */}
                  {showRatio && (
                    <div className='pt-3'>
                      <div className='flex items-center space-x-1 mb-2'>
                        <span className='text-xs font-medium text-gray-700'>
                          {t('倍率信息')}
                        </span>
                        <Tooltip
                          content={t('倍率是为了方便换算不同价格的模型')}
                        >
                          <IconHelpCircle
                            className='text-blue-500 cursor-pointer'
                            size='small'
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalImageUrl('/ratio.png');
                              setIsModalOpenurl(true);
                            }}
                          />
                        </Tooltip>
                      </div>
                      <div className='grid grid-cols-3 gap-2 text-xs text-gray-600'>
                        <div>
                          {t('模型')}:{' '}
                          {model.quota_type === 0 ? model.model_ratio : t('无')}
                        </div>
                        <div>
                          {t('补全')}:{' '}
                          {model.quota_type === 0
                            ? parseFloat(model.completion_ratio.toFixed(3))
                            : t('无')}
                        </div>
                        <div>
                          {t('分组')}: {priceData?.usedGroupRatio ?? '-'}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 性能摘要：状态 + 延迟 + 吞吐 */}
                  {renderPerfMetrics(model, t)}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 分页 */}
      {filteredModels.length > 0 && (
        <div className='flex justify-center mt-6 py-4 border-t pricing-pagination-divider'>
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            total={filteredModels.length}
            showSizeChanger={true}
            pageSizeOptions={[10, 20, 50, 100]}
            size={isMobile ? 'small' : 'default'}
            showQuickJumper={isMobile}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      )}

      <ModelFeedbackModal
        visible={!!feedbackModel}
        modelName={feedbackModel}
        onClose={() => setFeedbackModel(null)}
        t={t}
      />

      <ModelChannelTestModal
        visible={!!testModel}
        modelName={testModel}
        onClose={() => setTestModel(null)}
        t={t}
      />
    </div>
  );
};

export default PricingCardView;
