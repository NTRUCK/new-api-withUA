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
import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// 每日限额条目：模型 + 分组 + 每日成功调用上限
type DailyLimitEntry = {
  modelName: string
  group: string
  limit: number
}

type DailyLimitConfig = Record<string, Record<string, number>>

type ModelDailyLimitSectionProps = {
  defaultValues: {
    ModelDailyLimitEnabled: boolean
    ModelDailyLimit: string
  }
}

function parseConfig(value: string): DailyLimitConfig {
  if (!value || value.trim() === '') return {}
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as DailyLimitConfig
  } catch {
    return {}
  }
}

function configToEntries(config: DailyLimitConfig): DailyLimitEntry[] {
  const entries: DailyLimitEntry[] = []
  for (const [modelName, groups] of Object.entries(config)) {
    if (typeof groups !== 'object' || groups === null) continue
    for (const [group, limit] of Object.entries(groups)) {
      if (typeof limit === 'number') {
        entries.push({ modelName, group, limit })
      }
    }
  }
  return entries
}

export function ModelDailyLimitSection({
  defaultValues,
}: ModelDailyLimitSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const [enabled, setEnabled] = useState(defaultValues.ModelDailyLimitEnabled)
  const [configJson, setConfigJson] = useState(defaultValues.ModelDailyLimit)
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<DailyLimitEntry | null>(null)

  useEffect(() => {
    setEnabled(defaultValues.ModelDailyLimitEnabled)
    setConfigJson(defaultValues.ModelDailyLimit)
  }, [defaultValues.ModelDailyLimitEnabled, defaultValues.ModelDailyLimit])

  const entries = useMemo(
    () => configToEntries(parseConfig(configJson)),
    [configJson]
  )

  const filteredEntries = useMemo(() => {
    if (!searchText) return entries
    const lower = searchText.toLowerCase()
    return entries.filter(
      (e) =>
        e.modelName.toLowerCase().includes(lower) ||
        e.group.toLowerCase().includes(lower)
    )
  }, [entries, searchText])

  const persist = (nextEnabled: boolean, nextConfig: string) => {
    const updates: Array<{ key: string; value: string }> = []
    if (nextEnabled !== defaultValues.ModelDailyLimitEnabled) {
      updates.push({
        key: 'ModelDailyLimitEnabled',
        value: String(nextEnabled),
      })
    }
    if (nextConfig !== defaultValues.ModelDailyLimit) {
      updates.push({ key: 'ModelDailyLimit', value: nextConfig })
    }
    return updates
  }

  const onSave = async () => {
    const updates = persist(enabled, configJson)
    for (const u of updates) {
      await updateOption.mutateAsync(u)
    }
  }

  const handleSaveEntry = (data: DailyLimitEntry) => {
    const config = parseConfig(configJson)
    // 若编辑时改了 模型/分组，删除旧键
    if (
      editData &&
      (editData.modelName !== data.modelName || editData.group !== data.group)
    ) {
      if (config[editData.modelName]) {
        delete config[editData.modelName][editData.group]
        if (Object.keys(config[editData.modelName]).length === 0) {
          delete config[editData.modelName]
        }
      }
    }
    if (!config[data.modelName]) config[data.modelName] = {}
    config[data.modelName][data.group] = data.limit
    setConfigJson(JSON.stringify(config))
  }

  const handleDelete = (entry: DailyLimitEntry) => {
    const config = parseConfig(configJson)
    if (config[entry.modelName]) {
      delete config[entry.modelName][entry.group]
      if (Object.keys(config[entry.modelName]).length === 0) {
        delete config[entry.modelName]
      }
    }
    setConfigJson(JSON.stringify(config))
  }

  return (
    <SettingsSection title={t('Model Daily Limit')}>
      <SettingsPageFormActions
        onSave={onSave}
        isSaving={updateOption.isPending}
        saveLabel='Save daily limits'
      />

      <SettingsSwitchItem>
        <SettingsSwitchContent>
          <p className='text-sm font-medium'>
            {t('Enable per-model daily limit')}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Limits successful calls per model per group each day. Counts reset at midnight (server timezone). Only successful calls are counted.'
            )}
          </p>
        </SettingsSwitchContent>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </SettingsSwitchItem>

      <div className='flex items-center gap-4'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4' />
          <Input
            placeholder={t('Search model or group...')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className='pl-9'
          />
        </div>
        <Button
          type='button'
          onClick={() => {
            setEditData(null)
            setDialogOpen(true)
          }}
        >
          <Plus className='mr-2 h-4 w-4' />
          {t('Add limit')}
        </Button>
      </div>

      {filteredEntries.length === 0 ? (
        <div className='text-muted-foreground rounded-lg border border-dashed p-8 text-center'>
          {searchText
            ? t('No entries match your search')
            : t(
                'No daily limits configured. Click "Add limit" to get started.'
              )}
        </div>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Model')}</TableHead>
                <TableHead>{t('Group')}</TableHead>
                <TableHead className='text-right'>
                  {t('Daily limit')}
                </TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => (
                <TableRow key={`${entry.modelName}::${entry.group}`}>
                  <TableCell className='font-medium'>
                    {entry.modelName}
                  </TableCell>
                  <TableCell className='font-mono'>{entry.group}</TableCell>
                  <TableCell className='text-right font-mono'>
                    {entry.limit.toLocaleString()}
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex justify-end gap-2'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          setEditData(entry)
                          setDialogOpen(true)
                        }}
                      >
                        <Pencil className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleDelete(entry)}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DailyLimitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveEntry}
        editData={editData}
      />
    </SettingsSection>
  )
}

function DailyLimitDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: DailyLimitEntry) => void
  editData?: DailyLimitEntry | null
}) {
  const { t } = useTranslation()
  const { open, onOpenChange, onSave, editData } = props
  const isEdit = !!editData

  const [modelName, setModelName] = useState('')
  const [group, setGroup] = useState('')
  const [limit, setLimit] = useState(300)
  const [error, setError] = useState('')

  useEffect(() => {
    if (editData) {
      setModelName(editData.modelName)
      setGroup(editData.group)
      setLimit(editData.limit)
    } else {
      setModelName('')
      setGroup('')
      setLimit(300)
    }
    setError('')
  }, [editData, open])

  const submit = () => {
    if (!modelName.trim()) {
      setError(t('Model name is required'))
      return
    }
    if (!group.trim()) {
      setError(t('Group name is required'))
      return
    }
    if (!Number.isFinite(limit) || limit < 1) {
      setError(t('Daily limit must be >= 1'))
      return
    }
    onSave({ modelName: modelName.trim(), group: group.trim(), limit })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit daily limit') : t('Add daily limit')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Set the maximum number of successful calls per day for a model in a group.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('Model')}</label>
            <Input
              placeholder={t('e.g., gpt-4o')}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('Group')}</label>
            <Input
              placeholder={t('e.g., default')}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('Daily limit')}</label>
            <Input
              type='number'
              min={1}
              max={2147483647}
              step={1}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value) || 0)}
            />
          </div>
          {error && <p className='text-sm text-rose-500'>{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={submit}>
            {isEdit ? t('Update') : t('Add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
