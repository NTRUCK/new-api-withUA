/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2, UserX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestampToDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { batchDisableLogUsers, getAllLogs, getLogUsers } from '../../api'
import type { UsageLog } from '../../data/schema'
import { buildApiParams } from '../../lib/utils'
import type { GetLogsParams, LogUserStat } from '../../types'
import { DetailsDialog } from './details-dialog'

interface LogUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchParams: Record<string, unknown>
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
    queryKey: ['usage-log-user-details', props.user.user_id, props.filters, page],
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
              <span className='text-muted-foreground'>{log.token_name || '-'}</span>
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
        <div className='mt-2 flex items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('Previous')}
          </Button>
          <span className='text-muted-foreground text-xs'>
            {page} / {Math.ceil(total / pageSize)}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= Math.ceil(total / pageSize) || query.isFetching}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('Next')}
          </Button>
        </div>
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

function UserRow(props: { user: LogUserStat; filters: GetLogsParams }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='rounded-lg border'>
      <CollapsibleTrigger className='group flex w-full items-center gap-3 px-3 py-3 text-left'>
        <ChevronDown className='text-muted-foreground size-4 -rotate-90 transition-transform group-data-[panel-open]:rotate-0' />
        <div className='min-w-0 flex-1'>
          <div className='truncate font-medium'>{props.user.username || '-'}</div>
          <div className='text-muted-foreground text-xs'>ID: {props.user.user_id}</div>
        </div>
        <div className='text-right'>
          <div className='font-mono font-semibold'>{props.user.log_count}</div>
          <div className='text-muted-foreground text-xs'>{t('Logs')}</div>
        </div>
        <div className='text-muted-foreground hidden text-right text-xs sm:block'>
          {formatTimestampToDate(props.user.last_created_at)}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <UserLogs user={props.user} filters={props.filters} open={open} />
      </CollapsibleContent>
    </Collapsible>
  )
}

export function LogUsersDialog(props: LogUsersDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [excludeAdmins, setExcludeAdmins] = useState(true)
  const pageSize = 20
  const filters = buildApiParams({
    page: 1,
    pageSize: 1,
    searchParams: props.searchParams,
    columnFilters: [],
    isAdmin: true,
  })
  const query = useQuery({
    queryKey: ['usage-log-users', filters, page, excludeAdmins],
    queryFn: () =>
      getLogUsers({
        ...filters,
        p: page,
        page_size: pageSize,
        exclude_admins: excludeAdmins,
      }),
    enabled: props.open,
  })
  const users = query.data?.data?.items || []
  const total = query.data?.data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const disableMutation = useMutation({
    mutationFn: () => batchDisableLogUsers(filters),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || t('Operation failed'))
        return
      }
      toast.success(
        t('Disabled {{count}} users; skipped {{skipped}} protected or inactive users.', {
          count: result.data?.disabled_count || 0,
          skipped: result.data?.skipped_count || 0,
        })
      )
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['usage-log-users'] })
    },
    onError: () => toast.error(t('Operation failed')),
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='flex h-[min(720px,85vh)] flex-col overflow-hidden sm:max-w-4xl'>
        <DialogHeader>
          <div className='flex items-start justify-between gap-3 pr-7'>
            <div>
              <DialogTitle>{t('Matched Users')}</DialogTitle>
              <DialogDescription>
                {t('Matched {{count}} users. Expand a user to view logs.', {
                  count: total,
                })}
              </DialogDescription>
            </div>
            <Button
              variant='destructive'
              size='sm'
              disabled={total === 0 || !filters.user_agent}
              onClick={() => setConfirmOpen(true)}
            >
              <UserX />
              {t('Disable Matched Users')}
            </Button>
          </div>
        </DialogHeader>
        <div className='flex flex-wrap items-center justify-between gap-3'>
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
          <div className='bg-muted rounded-md px-3 py-1.5 text-sm'>
            {t('Users matching filters')}: <strong>{total}</strong>
          </div>
        </div>
        <div className='min-h-0 flex-1 space-y-2 overflow-y-auto pr-1'>
          {query.isLoading ? (
            <div className='flex justify-center py-12'>
              <Loader2 className='text-muted-foreground size-6 animate-spin' />
            </div>
          ) : (
            users.map((user) => (
              <UserRow key={user.user_id} user={user} filters={filters} />
            ))
          )}
          {!query.isLoading && users.length === 0 && (
            <div className='text-muted-foreground py-12 text-center'>
              {t('No results found')}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className='flex items-center justify-end gap-2 border-t pt-3'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('Previous')}
            </Button>
            <span className='text-muted-foreground text-xs'>
              {page} / {totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= totalPages || query.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        )}
      </DialogContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Disable Matched Users')}
        desc={t(
          'Disable all regular users matching the current filters? User ID 1 and all administrator accounts will always be excluded.'
        )}
        confirmText={t('Confirm Disable')}
        destructive
        isLoading={disableMutation.isPending}
        handleConfirm={() => disableMutation.mutate()}
      />
    </Dialog>
  )
}
