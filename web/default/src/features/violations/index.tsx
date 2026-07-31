/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { getPublicViolations } from './api'

export function Violations() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/violations/' })
  const navigate = useNavigate()
  const page = search.p || 1
  const query = useQuery({
    queryKey: ['public-violations', page],
    queryFn: () => getPublicViolations(page),
  })
  const data = query.data?.data
  const totalPages = Math.max(
    1,
    Math.ceil((data?.total || 0) / (data?.page_size || 12))
  )

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
        <header className='text-center'>
          <div className='text-destructive mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-red-500/10'>
            <AlertTriangle className='size-6' />
          </div>
          <h1 className='text-3xl font-semibold tracking-tight'>
            {t('Public violations')}
          </h1>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t('Public violation records')}
          </p>
        </header>
        {query.isLoading ? (
          <div className='flex justify-center py-16'>
            <Loader2 className='text-muted-foreground size-6 animate-spin' />
          </div>
        ) : query.isError ? (
          <div className='text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center'>
            {t('Unable to load violations')}
          </div>
        ) : data?.items.length ? (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {data.items.map((item) => (
              <Card
                key={`${item.display_name}-${item.last_recorded_at}`}
                className='overflow-hidden'
              >
                <CardContent className='space-y-4 p-5'>
                  <div className='flex items-center gap-3'>
                    <Avatar size='lg'>
                      <AvatarImage src={item.avatar_url || undefined} alt='' />
                      <AvatarFallback>
                        {(item.display_name || '?').slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className='min-w-0'>
                      <div className='truncate font-semibold'>
                        {item.display_name || '-'}
                      </div>
                      <div className='text-muted-foreground truncate text-sm'>
                        @{item.discord_username || '-'}
                      </div>
                    </div>
                  </div>
                  <div className='bg-muted/40 rounded-lg p-3 text-sm'>
                    <div className='text-muted-foreground mb-1 text-xs'>
                      {t('Reason')}
                    </div>
                    <div className='break-words'>{item.reason || '-'}</div>
                  </div>
                  <div className='grid grid-cols-2 gap-3 text-sm'>
                    <div>
                      <div className='text-muted-foreground text-xs'>
                        {t('Hit count')}
                      </div>
                      <div className='font-mono font-semibold'>
                        {item.hit_count}
                      </div>
                    </div>
                    <div>
                      <div className='text-muted-foreground text-xs'>
                        {t('First recorded')}
                      </div>
                      <div>
                        {new Date(
                          item.first_recorded_at * 1000
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className='col-span-2'>
                      <div className='text-muted-foreground text-xs'>
                        {t('Last recorded')}
                      </div>
                      <div>
                        {new Date(
                          item.last_recorded_at * 1000
                        ).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className='text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center'>
            {t('No violations found')}
          </div>
        )}
        {totalPages > 1 && (
          <div className='flex items-center justify-center gap-3'>
            <Button
              variant='outline'
              disabled={page <= 1 || query.isFetching}
              onClick={() =>
                navigate({ to: '/violations', search: { p: page - 1 } })
              }
            >
              {t('Previous')}
            </Button>
            <span className='text-muted-foreground text-sm'>
              {page} / {totalPages}
            </span>
            <Button
              variant='outline'
              disabled={page >= totalPages || query.isFetching}
              onClick={() =>
                navigate({ to: '/violations', search: { p: page + 1 } })
              }
            >
              {t('Next')}
            </Button>
          </div>
        )}
      </PageTransition>
    </PublicLayout>
  )
}
