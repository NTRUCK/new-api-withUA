/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect } from 'react'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Flag, Loader2, UserX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestampToDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status-badge'
import { USER_STATUSES } from '@/features/users/constants'
import {
  batchDisableLogUsers,
  getAllLogs,
  getInactiveUsers,
  getLogUsers,
  recordViolation,
} from '../../api'
import type { UsageLog } from '../../data/schema'
import { buildApiParams } from '../../lib/utils'
import type {
  GetLogsParams,
  InactiveUser,
  LogUserStat,
  ViolationInput,
  ViolationReasonCode,
} from '../../types'
import { DetailsDialog } from './details-dialog'

interface LogUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchParams: Record<string, unknown>
}

type UserMode = 'matched' | 'inactive'

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function ViolationDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitText: string
  destructive?: boolean
  isPending: boolean
  onSubmit: (input: ViolationInput) => void
}) {
  const { t } = useTranslation()
  const [reasonCode, setReasonCode] =
    useState<ViolationReasonCode>('tavo_client')
  const [reasonText, setReasonText] = useState('')
  const [listPublicly, setListPublicly] = useState(true)
  const customInvalid = reasonCode === 'custom' && !reasonText.trim()

  useEffect(() => {
    if (!props.open) {
      setReasonCode('tavo_client')
      setReasonText('')
      setListPublicly(true)
    }
  }, [props.open])

  const handleOpenChange = (open: boolean) => {
    props.onOpenChange(open)
    if (!open) {
      setReasonCode('tavo_client')
      setReasonText('')
      setListPublicly(true)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <label className='block space-y-2 text-sm'>
            <span className='font-medium'>{t('Violation reason')}</span>
            <Select
              value={reasonCode}
              onValueChange={(value) =>
                setReasonCode(value as ViolationReasonCode)
              }
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='tavo_client'>{t('TAVO client')}</SelectItem>
                <SelectItem value='custom'>{t('Other reason')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {reasonCode === 'custom' && (
            <label className='block space-y-2 text-sm'>
              <span className='font-medium'>{t('Reason details')}</span>
              <Input
                value={reasonText}
                maxLength={200}
                required
                placeholder={t('Enter a reason (up to 200 characters)')}
                onChange={(event) => setReasonText(event.target.value)}
              />
              <span className='text-muted-foreground block text-right text-xs'>
                {reasonText.length}/200
              </span>
            </label>
          )}
          <label className='flex cursor-pointer items-center gap-2 text-sm'>
            <Checkbox
              checked={listPublicly}
              onCheckedChange={(checked) => setListPublicly(checked === true)}
            />
            {t('Add to public violations board')}
          </label>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => handleOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant={props.destructive ? 'destructive' : 'default'}
            disabled={customInvalid || props.isPending}
            onClick={() =>
              props.onSubmit({
                reason_code: reasonCode,
                reason_text: reasonCode === 'custom' ? reasonText.trim() : '',
                list_publicly: listPublicly,
                increment_hit: true,
              })
            }
          >
            {props.isPending && <Loader2 className='animate-spin' />}
            {props.submitText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ViolationButton(props: { userId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: (input: ViolationInput) => recordViolation(props.userId, input),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t('Operation failed'))
        return
      }
      toast.success(t('Violation recorded'))
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['inactive-users'] })
    },
    onError: () => toast.error(t('Operation failed')),
  })

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Flag />
        {t('Record violation / List publicly')}
      </Button>
      <ViolationDialog
        open={open}
        onOpenChange={setOpen}
        title={t('Record violation')}
        description={t(
          'Record this user violation and optionally list it publicly.'
        )}
        submitText={t('Record violation')}
        isPending={mutation.isPending}
        onSubmit={(input) => mutation.mutate(input)}
      />
    </>
  )
}

function UserLogs(props: {
  user: LogUserStat
  filters: GetLogsParams
  open: boolean
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState<UsageLog | null>(null)
  const pageSize = 20
  const query = useQuery({
    queryKey: [
      'usage-log-user-details',
      props.user.user_id,
      props.filters,
      page,
    ],
    queryFn: () =>
      getAllLogs({
        ...props.filters,
        user_id: props.user.user_id,
        p: page,
        page_size: pageSize,
      }),
    enabled: props.open,
  })
  const logs = (query.data?.data?.items || []) as UsageLog[]
  const total = query.data?.data?.total || 0

  if (query.isLoading) {
    return (
      <div className='flex justify-center py-6'>
        <Loader2 className='text-muted-foreground size-5 animate-spin' />
      </div>
    )
  }

  return (
    <div className='bg-muted/20 min-w-0 border-t px-3 py-2'>
      <div className='w-full overflow-x-auto pb-1'>
        <div className='min-w-max space-y-1'>
          {logs.map((log) => (
            <div
              key={log.id}
              className='bg-background flex min-w-[760px] items-center gap-3 rounded-md border px-3 py-2 text-xs'
            >
              <span className='text-muted-foreground font-mono'>#{log.id}</span>
              <span>{formatTimestampToDate(log.created_at)}</span>
              <span className='font-medium'>{log.model_name || '-'}</span>
              <span className='text-muted-foreground'>
                {log.token_name || '-'}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='ml-auto h-7'
                onClick={() => setSelectedLog(log)}
              >
                {t('Details')}
              </Button>
            </div>
          ))}
        </div>
      </div>
      {logs.length === 0 && (
        <div className='text-muted-foreground py-5 text-center text-xs'>
          {t('No results found')}
        </div>
      )}
      {total > pageSize && (
        <Pagination
          page={page}
          totalPages={Math.ceil(total / pageSize)}
          disabled={query.isFetching}
          onPageChange={setPage}
        />
      )}
      {selectedLog && (
        <DetailsDialog
          log={selectedLog}
          isAdmin
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setSelectedLog(null)
          }}
        />
      )}
    </div>
  )
}

function MatchedUserRow(props: { user: LogUserStat; filters: GetLogsParams }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='rounded-lg border'
    >
      <div className='flex items-center gap-2 pr-3'>
        <CollapsibleTrigger className='group flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left'>
          <ChevronDown className='text-muted-foreground size-4 -rotate-90 transition-transform group-data-[panel-open]:rotate-0' />
          <div className='min-w-0 flex-1'>
            <div className='truncate font-medium'>
              {props.user.username || '-'}
            </div>
            <div className='text-muted-foreground text-xs'>
              ID: {props.user.user_id}
            </div>
          </div>
          <div className='text-right'>
            <div className='font-mono font-semibold'>
              {props.user.log_count}
            </div>
            <div className='text-muted-foreground text-xs'>{t('Logs')}</div>
          </div>
          <div className='text-muted-foreground hidden text-right text-xs sm:block'>
            {formatTimestampToDate(props.user.last_created_at)}
          </div>
        </CollapsibleTrigger>
        <ViolationButton userId={props.user.user_id} />
      </div>
      <CollapsibleContent>
        <UserLogs user={props.user} filters={props.filters} open={open} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function InactiveUserRow(props: { user: InactiveUser }) {
  const { t } = useTranslation()
  const status = USER_STATUSES[props.user.status as keyof typeof USER_STATUSES]

  return (
    <div className='flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3'>
      <div className='min-w-[180px] flex-1'>
        <div className='truncate font-medium'>
          {props.user.display_name || props.user.username || '-'}
        </div>
        <div className='text-muted-foreground truncate text-xs'>
          {props.user.username} · ID: {props.user.id}
        </div>
      </div>
      {status && (
        <StatusBadge
          label={t(status.labelKey)}
          variant={status.variant}
          copyable={false}
        />
      )}
      <StatusBadge
        label={
          props.user.on_violation_board
            ? t('On public violations board')
            : t('Not on public violations board')
        }
        variant={props.user.on_violation_board ? 'warning' : 'neutral'}
        copyable={false}
      />
      <div className='text-muted-foreground min-w-[150px] text-xs'>
        <div>
          {t('Created')}: {formatTimestampToDate(props.user.created_at)}
        </div>
        <div>
          {t('Last login')}:{' '}
          {props.user.last_login_at
            ? formatTimestampToDate(props.user.last_login_at)
            : '-'}
        </div>
      </div>
      <ViolationButton userId={props.user.id} />
    </div>
  )
}

function Pagination(props: {
  page: number
  totalPages: number
  disabled: boolean
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='mt-2 flex items-center justify-end gap-2 border-t pt-3'>
      <Button
        variant='outline'
        size='sm'
        disabled={props.page <= 1 || props.disabled}
        onClick={() => props.onPageChange(props.page - 1)}
      >
        {t('Previous')}
      </Button>
      <span className='text-muted-foreground text-xs'>
        {props.page} / {props.totalPages}
      </span>
      <Button
        variant='outline'
        size='sm'
        disabled={props.page >= props.totalPages || props.disabled}
        onClick={() => props.onPageChange(props.page + 1)}
      >
        {t('Next')}
      </Button>
    </div>
  )
}

export function LogUsersDialog(props: LogUsersDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<UserMode>('matched')
  const [page, setPage] = useState(1)
  const [disableOpen, setDisableOpen] = useState(false)
  const [excludeAdmins, setExcludeAdmins] = useState(true)
  const [inactiveStart, setInactiveStart] = useState('')
  const [inactiveEnd, setInactiveEnd] = useState('')
  const pageSize = 20

  useEffect(() => {
    if (!props.open) return
    const end = new Date()
    setInactiveStart(
      toDateTimeLocal(new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000))
    )
    setInactiveEnd(toDateTimeLocal(end))
    setPage(1)
  }, [props.open])
  const filters = buildApiParams({
    page: 1,
    pageSize: 1,
    searchParams: props.searchParams,
    columnFilters: [],
    isAdmin: true,
  })
  const matchedQuery = useQuery({
    queryKey: ['usage-log-users', filters, page, excludeAdmins],
    queryFn: () =>
      getLogUsers({
        ...filters,
        p: page,
        page_size: pageSize,
        exclude_admins: excludeAdmins,
      }),
    enabled: props.open && mode === 'matched',
  })
  const startTimestamp = Math.floor(new Date(inactiveStart).getTime() / 1000)
  const endTimestamp = Math.floor(new Date(inactiveEnd).getTime() / 1000)
  const validInactiveRange =
    Number.isFinite(startTimestamp) &&
    Number.isFinite(endTimestamp) &&
    startTimestamp < endTimestamp
  const inactiveQuery = useQuery({
    queryKey: ['inactive-users', startTimestamp, endTimestamp, page],
    queryFn: () =>
      getInactiveUsers({
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
        p: page,
        page_size: pageSize,
      }),
    enabled: props.open && mode === 'inactive' && validInactiveRange,
  })
  const activeQuery = mode === 'matched' ? matchedQuery : inactiveQuery
  const users = activeQuery.data?.data?.items || []
  const total = activeQuery.data?.data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const disableMutation = useMutation({
    mutationFn: (violation: ViolationInput) =>
      batchDisableLogUsers(filters, violation),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t('Operation failed'))
        return
      }
      toast.success(
        t(
          'Disabled {{count}} users; listed {{listed}}; skipped {{skipped}} protected or inactive users.',
          {
            count: result.data?.disabled_count || 0,
            listed: result.data?.listed_count || 0,
            skipped: result.data?.skipped_count || 0,
          }
        )
      )
      setDisableOpen(false)
      queryClient.invalidateQueries({ queryKey: ['usage-log-users'] })
    },
    onError: () => toast.error(t('Operation failed')),
  })

  const changeMode = (nextMode: UserMode) => {
    setMode(nextMode)
    setPage(1)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='flex h-[min(760px,90vh)] flex-col overflow-hidden sm:max-w-5xl'>
        <DialogHeader>
          <div className='flex items-start justify-between gap-3 pr-7'>
            <div>
              <DialogTitle>{t('User statistics')}</DialogTitle>
              <DialogDescription>
                {mode === 'matched'
                  ? t('Matched {{count}} users. Expand a user to view logs.', {
                      count: total,
                    })
                  : t('Found {{count}} users with no calls in this period.', {
                      count: total,
                    })}
              </DialogDescription>
            </div>
            {mode === 'matched' && (
              <Button
                variant='destructive'
                size='sm'
                disabled={total === 0 || !filters.user_agent}
                onClick={() => setDisableOpen(true)}
              >
                <UserX />
                {t('Disable Matched Users')}
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='bg-muted flex rounded-lg p-1'>
            <Button
              variant={mode === 'matched' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => changeMode('matched')}
            >
              {t('Match log filters')}
            </Button>
            <Button
              variant={mode === 'inactive' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => changeMode('inactive')}
            >
              {t('No calls in date range')}
            </Button>
          </div>
          <div className='bg-muted rounded-md px-3 py-1.5 text-sm'>
            {t('Total users')}: <strong>{total}</strong>
          </div>
        </div>
        {mode === 'matched' ? (
          <label className='flex cursor-pointer items-center gap-2 text-sm'>
            <Checkbox
              checked={excludeAdmins}
              onCheckedChange={(checked) => {
                setExcludeAdmins(checked === true)
                setPage(1)
              }}
            />
            {t('Exclude administrator logs')}
          </label>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='space-y-1 text-sm'>
              <span className='text-muted-foreground'>{t('Start time')}</span>
              <Input
                type='datetime-local'
                value={inactiveStart}
                onChange={(event) => {
                  setInactiveStart(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span className='text-muted-foreground'>{t('End time')}</span>
              <Input
                type='datetime-local'
                value={inactiveEnd}
                onChange={(event) => {
                  setInactiveEnd(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            {!validInactiveRange && (
              <p className='text-destructive text-xs sm:col-span-2'>
                {t('Start time must be earlier than end time')}
              </p>
            )}
          </div>
        )}
        <div className='min-h-0 flex-1 space-y-2 overflow-y-auto pr-1'>
          {activeQuery.isLoading || activeQuery.isFetching ? (
            <div className='flex justify-center py-12'>
              <Loader2 className='text-muted-foreground size-6 animate-spin' />
            </div>
          ) : mode === 'matched' ? (
            (users as LogUserStat[]).map((user) => (
              <MatchedUserRow
                key={user.user_id}
                user={user}
                filters={filters}
              />
            ))
          ) : (
            (users as InactiveUser[]).map((user) => (
              <InactiveUserRow key={user.id} user={user} />
            ))
          )}
          {!activeQuery.isLoading &&
            users.length === 0 &&
            validInactiveRange && (
              <div className='text-muted-foreground py-12 text-center'>
                {t('No results found')}
              </div>
            )}
        </div>
        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            disabled={activeQuery.isFetching}
            onPageChange={setPage}
          />
        )}
      </DialogContent>
      <ViolationDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={t('Disable Matched Users')}
        description={t(
          'Disable all regular users matching the current filters and record the violation. User ID 1 and administrator accounts are always excluded.'
        )}
        submitText={t('Confirm Disable')}
        destructive
        isPending={disableMutation.isPending}
        onSubmit={(input) => disableMutation.mutate(input)}
      />
    </Dialog>
  )
}
