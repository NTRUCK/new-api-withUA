/*
Copyright (C) 2023-2026 QuantumNous

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
import { useState, useEffect, Fragment } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  RefreshCw,
  Trash2,
  Power,
  PowerOff,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Pencil,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import {
  getMultiKeyStatus,
  enableMultiKey,
  disableMultiKey,
  deleteMultiKey,
  enableAllMultiKeys,
  disableAllMultiKeys,
  deleteDisabledMultiKeys,
  setMultiKeyProxy,
} from '../../api'
import { MULTI_KEY_FILTER_OPTIONS } from '../../constants'
import {
  channelsQueryKeys,
  formatTimestamp,
  getMultiKeyStatusConfig,
  getMultiKeyConfirmMessage,
  isDestructiveAction,
} from '../../lib'
import type { KeyStatus, MultiKeyConfirmAction } from '../../types'
import { useChannels } from '../channels-provider'
import { StatisticsCard } from './multi-key-statistics-card'
import { MultiKeyTableRowActions } from './multi-key-table-row-actions'

type MultiKeyManageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MultiKeyManageDialog({
  open,
  onOpenChange,
}: MultiKeyManageDialogProps) {
  const { t } = useTranslation()
  const { currentRow } = useChannels()
  const queryClient = useQueryClient()

  // Data state
  const [isLoading, setIsLoading] = useState(false)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [enabledCount, setEnabledCount] = useState(0)
  const [manualDisabledCount, setManualDisabledCount] = useState(0)
  const [autoDisabledCount, setAutoDisabledCount] = useState(0)

  // UI state
  const [statusFilter, setStatusFilter] = useState<number | null>(null)
  const [confirmAction, setConfirmAction] =
    useState<MultiKeyConfirmAction | null>(null)
  const [isPerformingAction, setIsPerformingAction] = useState(false)
  // 记录哪些行展开了报错历史（key: index）
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

  // 每 key 代理编辑状态：正在编辑的 index、输入框值、保存中标志
  const [editingProxyIndex, setEditingProxyIndex] = useState<number | null>(
    null
  )
  const [proxyDraft, setProxyDraft] = useState('')
  const [savingProxy, setSavingProxy] = useState(false)

  const toggleRowExpanded = (index: number) => {
    setExpandedRows((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  const startEditProxy = (index: number, current: string) => {
    setEditingProxyIndex(index)
    setProxyDraft(current)
  }

  const cancelEditProxy = () => {
    setEditingProxyIndex(null)
    setProxyDraft('')
  }

  const saveProxy = async (index: number) => {
    if (!currentRow) return
    setSavingProxy(true)
    try {
      const res = await setMultiKeyProxy(currentRow.id, index, proxyDraft.trim())
      if (res?.success) {
        toast.success(res.message || t('Operation successful'))
        setEditingProxyIndex(null)
        setProxyDraft('')
        loadKeyStatus(currentPage, pageSize)
      } else {
        toast.error(res?.message || t('Operation failed'))
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    } finally {
      setSavingProxy(false)
    }
  }

  // Reset and load data when dialog opens
  useEffect(() => {
    if (open && currentRow) {
      setCurrentPage(1)
      setStatusFilter(null)
      loadKeyStatus(1, pageSize, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentRow?.id])

  const loadKeyStatus = async (
    page: number = currentPage,
    size: number = pageSize,
    status: number | null = statusFilter
  ) => {
    if (!currentRow) return

    setIsLoading(true)
    try {
      const response = await getMultiKeyStatus(
        currentRow.id,
        page,
        size,
        status === null ? undefined : status
      )

      if (response.success && response.data) {
        setKeys(response.data.keys || [])
        setTotal(response.data.total || 0)
        setCurrentPage(response.data.page || 1)
        setPageSize(response.data.page_size || 10)
        setTotalPages(response.data.total_pages || 0)
        setEnabledCount(response.data.enabled_count || 0)
        setManualDisabledCount(response.data.manual_disabled_count || 0)
        setAutoDisabledCount(response.data.auto_disabled_count || 0)
      } else {
        toast.error(response.message || t('Failed to load key status'))
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to load key status')
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleStatusFilterChange = (value: string) => {
    const newFilter = value === 'all' ? null : parseInt(value)
    setStatusFilter(newFilter)
    setCurrentPage(1)
    loadKeyStatus(1, pageSize, newFilter)
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    loadKeyStatus(newPage, pageSize)
  }

  const performAction = async () => {
    if (!confirmAction || !currentRow) return

    setIsPerformingAction(true)
    try {
      const { type, keyIndex } = confirmAction
      let response

      // Execute the appropriate action
      if (type === 'enable' && keyIndex !== undefined) {
        response = await enableMultiKey(currentRow.id, keyIndex)
      } else if (type === 'disable' && keyIndex !== undefined) {
        response = await disableMultiKey(currentRow.id, keyIndex)
      } else if (type === 'delete' && keyIndex !== undefined) {
        response = await deleteMultiKey(currentRow.id, keyIndex)
      } else if (type === 'enable-all') {
        response = await enableAllMultiKeys(currentRow.id)
      } else if (type === 'disable-all') {
        response = await disableAllMultiKeys(currentRow.id)
      } else if (type === 'delete-disabled') {
        response = await deleteDisabledMultiKeys(currentRow.id)
      }

      if (response?.success) {
        toast.success(response.message || t('Operation successful'))
        queryClient.invalidateQueries({ queryKey: channelsQueryKeys.lists() })

        // Reload data - reset to page 1 for bulk actions
        const isBulkAction = type.includes('all') || type === 'delete-disabled'
        if (isBulkAction) {
          setCurrentPage(1)
          loadKeyStatus(1, pageSize)
        } else {
          loadKeyStatus(currentPage, pageSize)
        }
      } else {
        toast.error(response?.message || t('Operation failed'))
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    } finally {
      setIsPerformingAction(false)
      setConfirmAction(null)
    }
  }

  const renderStatusBadge = (status: number) => {
    const config = getMultiKeyStatusConfig(status)
    return (
      <StatusBadge
        label={t(config.label)}
        variant={config.variant}
        showDot
        copyable={false}
      />
    )
  }

  const formatKeyTimestamp = (timestamp?: number) => {
    if (!timestamp) return '-'
    return formatTimestamp(timestamp)
  }

  if (!currentRow) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='flex max-h-[90vh] max-w-5xl flex-col'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              {t('Multi-Key Management')}
              <StatusBadge
                label={currentRow.name}
                variant='neutral'
                copyable={false}
              />
              {currentRow.channel_info?.multi_key_mode && (
                <StatusBadge
                  label={
                    currentRow.channel_info.multi_key_mode === 'random'
                      ? t('Random')
                      : t('Polling')
                  }
                  variant='neutral'
                  copyable={false}
                />
              )}
            </DialogTitle>
            <DialogDescription>
              {t('Manage multi-key status and configuration for this channel')}
            </DialogDescription>
          </DialogHeader>

          <div className='flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden'>
            {/* Statistics */}
            <div className='grid shrink-0 grid-cols-3 gap-3'>
              <StatisticsCard
                label={t('Enabled')}
                count={enabledCount}
                total={total}
              />
              <StatisticsCard
                label={t('Manual Disabled')}
                count={manualDisabledCount}
                total={total}
              />
              <StatisticsCard
                label={t('Auto Disabled')}
                count={autoDisabledCount}
                total={total}
              />
            </div>

            <Separator className='shrink-0' />

            {/* Toolbar */}
            <div className='flex shrink-0 items-center justify-between'>
              <Select
                items={[
                  ...MULTI_KEY_FILTER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                  })),
                ]}
                value={statusFilter === null ? 'all' : statusFilter.toString()}
                onValueChange={(v) => v !== null && handleStatusFilterChange(v)}
              >
                <SelectTrigger className='w-40'>
                  <SelectValue placeholder={t('All Status')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {MULTI_KEY_FILTER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.label)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => loadKeyStatus()}
                  disabled={isLoading}
                >
                  <RefreshCw className='h-4 w-4' />
                </Button>

                {manualDisabledCount + autoDisabledCount > 0 && (
                  <Button
                    variant='default'
                    size='sm'
                    onClick={() => setConfirmAction({ type: 'enable-all' })}
                  >
                    <Power className='mr-2 h-4 w-4' />
                    {t('Enable All')}
                  </Button>
                )}

                {enabledCount > 0 && (
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={() => setConfirmAction({ type: 'disable-all' })}
                  >
                    <PowerOff className='mr-2 h-4 w-4' />
                    {t('Disable All')}
                  </Button>
                )}

                {autoDisabledCount > 0 && (
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={() =>
                      setConfirmAction({ type: 'delete-disabled' })
                    }
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    {t('Delete Auto-Disabled')}
                  </Button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className='min-h-0 flex-1 overflow-auto rounded-md border'>
              {isLoading ? (
                <div className='flex items-center justify-center py-12'>
                  <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
                </div>
              ) : keys.length === 0 ? (
                <div className='text-muted-foreground py-12 text-center'>
                  {t('No keys found')}
                </div>
              ) : (
                <div className='min-w-[800px]'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-20'>{t('Index')}</TableHead>
                        <TableHead className='min-w-[200px]'>
                          {t('Key')}
                        </TableHead>
                        <TableHead className='w-32'>{t('Status')}</TableHead>
                        <TableHead className='min-w-[220px]'>
                          {t('Proxy')}
                        </TableHead>
                        <TableHead className='min-w-[200px]'>
                          {t('Disabled Reason')}
                        </TableHead>
                        <TableHead className='w-44'>
                          {t('Disabled Time')}
                        </TableHead>
                        <TableHead className='w-32'>
                          {t('Error History')}
                        </TableHead>
                        <TableHead className='w-44 text-right'>
                          {t('Actions')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keys.map((key) => {
                        const errorLog = key.error_log ?? []
                        const hasErrors = errorLog.length > 0
                        const isExpanded = !!expandedRows[key.index]
                        // 按时间倒序展示（最新在前）
                        const sortedLog = hasErrors
                          ? [...errorLog].sort((a, b) => b.time - a.time)
                          : []
                        return (
                          <Fragment key={key.index}>
                            <TableRow key={key.index}>
                              <TableCell className='font-mono text-sm'>
                                #{key.index + 1}
                              </TableCell>
                              <TableCell className='max-w-[240px] text-sm'>
                                {key.key ? (
                                  <button
                                    type='button'
                                    className='hover:text-primary block w-full truncate text-left font-mono text-xs'
                                    title={t('Click to copy')}
                                    onClick={() => {
                                      navigator.clipboard
                                        ?.writeText(key.key as string)
                                        .then(() =>
                                          toast.success(t('Copied'))
                                        )
                                        .catch(() => {})
                                    }}
                                  >
                                    {key.key}
                                  </button>
                                ) : (
                                  <span className='text-muted-foreground'>
                                    -
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {renderStatusBadge(key.status)}
                              </TableCell>
                              <TableCell className='text-sm'>
                                {editingProxyIndex === key.index ? (
                                  <div className='flex items-center gap-1'>
                                    <Input
                                      value={proxyDraft}
                                      onChange={(e) =>
                                        setProxyDraft(e.target.value)
                                      }
                                      placeholder='http://127.0.0.1:7801'
                                      className='h-7 font-mono text-xs'
                                      disabled={savingProxy}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveProxy(key.index)
                                        if (e.key === 'Escape') cancelEditProxy()
                                      }}
                                    />
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      className='h-7 w-7 p-0'
                                      disabled={savingProxy}
                                      onClick={() => saveProxy(key.index)}
                                    >
                                      {savingProxy ? (
                                        <Loader2 className='h-4 w-4 animate-spin' />
                                      ) : (
                                        <Check className='h-4 w-4 text-green-600' />
                                      )}
                                    </Button>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      className='h-7 w-7 p-0'
                                      disabled={savingProxy}
                                      onClick={cancelEditProxy}
                                    >
                                      <X className='h-4 w-4' />
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    type='button'
                                    className='hover:text-primary group flex w-full items-center gap-1 text-left font-mono text-xs'
                                    title={t('Click to edit')}
                                    onClick={() =>
                                      startEditProxy(key.index, key.proxy || '')
                                    }
                                  >
                                    <span className='truncate'>
                                      {key.proxy || (
                                        <span className='text-muted-foreground'>
                                          {t('Channel default')}
                                        </span>
                                      )}
                                    </span>
                                    <Pencil className='h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60' />
                                  </button>
                                )}
                              </TableCell>
                              <TableCell className='max-w-xs text-sm'>
                                {key.disabled_code === 'quota_exhausted' && (
                                  <Badge
                                    variant='outline'
                                    className='mr-2 border-orange-300 text-orange-600'
                                    title={t(
                                      'This key was auto-disabled for insufficient quota and will be skipped in future polling.'
                                    )}
                                  >
                                    {t('Insufficient Quota')}
                                  </Badge>
                                )}
                                <span className='truncate'>
                                  {key.reason || '-'}
                                </span>
                              </TableCell>
                              <TableCell className='text-muted-foreground text-sm'>
                                {formatKeyTimestamp(key.disabled_time)}
                              </TableCell>
                              <TableCell>
                                {hasErrors ? (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 px-2'
                                    onClick={() => toggleRowExpanded(key.index)}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className='mr-1 h-4 w-4' />
                                    ) : (
                                      <ChevronRight className='mr-1 h-4 w-4' />
                                    )}
                                    {t('{{count}} records', {
                                      count: sortedLog.length,
                                    })}
                                  </Button>
                                ) : (
                                  <span className='text-muted-foreground text-sm'>
                                    -
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <MultiKeyTableRowActions
                                  keyIndex={key.index}
                                  status={key.status}
                                  onAction={setConfirmAction}
                                />
                              </TableCell>
                            </TableRow>
                            {isExpanded && hasErrors && (
                              <TableRow
                                key={`${key.index}-errors`}
                                className='bg-muted/30 hover:bg-muted/30'
                              >
                                <TableCell colSpan={8} className='p-0'>
                                  <div className='space-y-1 px-6 py-3'>
                                    {sortedLog.map((log, idx) => (
                                      <div
                                        key={idx}
                                        className='flex items-start gap-3 text-sm'
                                      >
                                        <span className='text-muted-foreground w-40 shrink-0 font-mono text-xs'>
                                          {formatKeyTimestamp(log.time)}
                                        </span>
                                        <Badge
                                          variant='outline'
                                          className='shrink-0 border-red-300 text-red-600'
                                        >
                                          {log.status_code}
                                        </Badge>
                                        <span className='min-w-0 flex-1 break-all'>
                                          {log.message}
                                        </span>
                                        {log.count > 1 && (
                                          <Badge
                                            variant='secondary'
                                            className='shrink-0'
                                          >
                                            {t('{{count}} times', {
                                              count: log.count,
                                            })}
                                          </Badge>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className='flex shrink-0 items-center justify-between'>
                <div className='text-muted-foreground text-sm'>
                  {t('Page {{current}} of {{total}}', {
                    current: currentPage,
                    total: totalPages,
                  })}
                </div>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || isLoading}
                  >
                    {t('Previous')}
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages || isLoading}
                  >
                    {t('Next')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={t('Confirm Action')}
        desc={t(getMultiKeyConfirmMessage(confirmAction))}
        destructive={isDestructiveAction(confirmAction)}
        isLoading={isPerformingAction}
        handleConfirm={performAction}
      />
    </>
  )
}
