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
type DailyLimitTier = {
  from: number
  to: number
  multiplier: number
}

type DailyLimitEntry = {
  modelName: string
  group: string
  limit: number
  tiers: DailyLimitTier[]
}

type DailyLimitConfig = Record<string, Record<string, number>>
type DailyLimitTierConfig = Record<string, Record<string, DailyLimitTier[]>>

type SharedLimitGroup = {
  name: string
  models: string[]
  limits: Record<string, number>
  tiers?: Record<string, DailyLimitTier[]>
  reset_hour?: number
}

type SharedLimitEntry = DailyLimitEntry & {
  sharedName: string
  models: string[]
  resetHour: number
}

type ModelDailyLimitSectionProps = {
  defaultValues: {
    ModelDailyLimitEnabled: boolean
    ModelDailyLimit: string
    ModelDailyLimitTiers: string
    ModelDailyLimitResetHours: string
    ModelDailyLimitGroups: string
  }
}

function parseConfig(value: string): DailyLimitConfig {
  if (!value || value.trim() === '') return {}
  try {
    const parsed = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as DailyLimitConfig
  } catch {
    return {}
  }
}

function parseTierConfig(value: string): DailyLimitTierConfig {
  if (!value || value.trim() === '') return {}
  try {
    const parsed = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as DailyLimitTierConfig
  } catch {
    return {}
  }
}

function configToEntries(
  config: DailyLimitConfig,
  tierConfig: DailyLimitTierConfig
): DailyLimitEntry[] {
  const entries: DailyLimitEntry[] = []
  for (const [modelName, groups] of Object.entries(config)) {
    if (typeof groups !== 'object' || groups === null) continue
    for (const [group, limit] of Object.entries(groups)) {
      if (typeof limit === 'number') {
        entries.push({
          modelName,
          group,
          limit,
          tiers: tierConfig[modelName]?.[group] ?? [],
        })
      }
    }
  }
  return entries
}

function parseSharedGroups(value: string): SharedLimitGroup[] {
  if (!value || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as SharedLimitGroup[]) : []
  } catch {
    return []
  }
}

function sharedGroupsToEntries(groups: SharedLimitGroup[]): SharedLimitEntry[] {
  return groups.flatMap((shared) =>
    Object.entries(shared.limits ?? {}).map(([group, limit]) => ({
      sharedName: shared.name,
      models: shared.models ?? [],
      modelName: shared.models?.join(', ') ?? '',
      group,
      limit,
      tiers: shared.tiers?.[group] ?? [],
      resetHour: shared.reset_hour ?? 0,
    }))
  )
}

function SharedLimitDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: SharedLimitEntry) => void
  editData?: SharedLimitEntry | null
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState('')
  const [group, setGroup] = useState('')
  const [limit, setLimit] = useState(500)
  const [resetHour, setResetHour] = useState(0)
  const [tiers, setTiers] = useState<DailyLimitTier[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    setModels(props.editData?.models.join(', ') ?? '')
    setGroup(props.editData?.group ?? '')
    setLimit(props.editData?.limit ?? 500)
    setResetHour(props.editData?.resetHour ?? 0)
    setTiers(props.editData?.tiers ?? [])
    setError('')
  }, [props.editData, props.open])

  const submit = () => {
    const modelList = models
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (modelList.length === 0 || !group.trim() || limit < 1) {
      setError(t('Models, group and daily limit are required'))
      return
    }
    const sorted = [...tiers].sort((a, b) => a.from - b.from)
    const invalid = sorted.some(
      (tier, index) =>
        tier.from < 1 ||
        tier.to < tier.from ||
        tier.to > limit ||
        tier.multiplier <= 0 ||
        (index > 0 && tier.from <= sorted[index - 1].to)
    )
    if (invalid) {
      setError(
        t(
          'Billing tiers must be valid, non-overlapping and within the daily limit'
        )
      )
      return
    }
    props.onSave({
      sharedName: props.editData?.sharedName ?? `shared-${Date.now()}`,
      models: modelList,
      modelName: modelList.join(', '),
      group: group.trim(),
      limit,
      resetHour,
      tiers: sorted,
    })
    props.onOpenChange(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-[620px]'>
        <DialogHeader>
          <DialogTitle>
            {props.editData ? t('Edit shared limit') : t('Add shared limit')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Models in this row share the same daily counter and billing tiers.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('Models')}</label>
            <Input
              value={models}
              onChange={(event) => setModels(event.target.value)}
              placeholder={t('Comma-separated model names')}
            />
          </div>
          <div className='grid grid-cols-3 gap-3'>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>{t('Group')}</label>
              <Input
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>{t('Daily limit')}</label>
              <Input
                type='number'
                min={1}
                value={limit}
                onChange={(event) =>
                  setLimit(parseInt(event.target.value) || 0)
                }
              />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>{t('Reset hour')}</label>
              <Input
                type='number'
                min={0}
                max={23}
                value={resetHour}
                onChange={(event) =>
                  setResetHour(parseInt(event.target.value) || 0)
                }
              />
            </div>
          </div>
          <TierRows tiers={tiers} limit={limit} onChange={setTiers} />
          {error && <p className='text-sm text-rose-500'>{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={submit}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TierRows(props: {
  tiers: DailyLimitTier[]
  limit: number
  onChange: (tiers: DailyLimitTier[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <label className='text-sm font-medium'>{t('Billing tiers')}</label>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            props.onChange([
              ...props.tiers,
              {
                from: props.tiers.at(-1)?.to ? props.tiers.at(-1)!.to + 1 : 1,
                to: props.limit,
                multiplier: 1,
              },
            ])
          }
        >
          <Plus className='mr-1 h-3.5 w-3.5' />
          {t('Add tier')}
        </Button>
      </div>
      {props.tiers.map((tier, index) => (
        <div key={index} className='grid grid-cols-[1fr_1fr_1fr_auto] gap-2'>
          <Input
            type='number'
            min={1}
            value={tier.from}
            onChange={(event) => {
              const next = [...props.tiers]
              next[index] = {
                ...tier,
                from: parseInt(event.target.value) || 0,
              }
              props.onChange(next)
            }}
          />
          <Input
            type='number'
            min={1}
            max={props.limit}
            value={tier.to}
            onChange={(event) => {
              const next = [...props.tiers]
              next[index] = {
                ...tier,
                to: parseInt(event.target.value) || 0,
              }
              props.onChange(next)
            }}
          />
          <Input
            type='number'
            min={0.01}
            step={0.1}
            value={tier.multiplier}
            onChange={(event) => {
              const next = [...props.tiers]
              next[index] = {
                ...tier,
                multiplier: parseFloat(event.target.value) || 0,
              }
              props.onChange(next)
            }}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() =>
              props.onChange(
                props.tiers.filter((_, itemIndex) => itemIndex !== index)
              )
            }
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
    </div>
  )
}

function formatTiers(tiers: DailyLimitTier[]) {
  if (tiers.length === 0) return '-'
  return tiers
    .map((tier) => `${tier.from}-${tier.to}: ${tier.multiplier}x`)
    .join(', ')
}

export function ModelDailyLimitSection({
  defaultValues,
}: ModelDailyLimitSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const [enabled, setEnabled] = useState(defaultValues.ModelDailyLimitEnabled)
  const [configJson, setConfigJson] = useState(defaultValues.ModelDailyLimit)
  const [tiersJson, setTiersJson] = useState(defaultValues.ModelDailyLimitTiers)
  const [groupsJson, setGroupsJson] = useState(
    defaultValues.ModelDailyLimitGroups
  )
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<DailyLimitEntry | null>(null)
  const [sharedDialogOpen, setSharedDialogOpen] = useState(false)
  const [sharedEditData, setSharedEditData] = useState<SharedLimitEntry | null>(
    null
  )

  useEffect(() => {
    setEnabled(defaultValues.ModelDailyLimitEnabled)
    setConfigJson(defaultValues.ModelDailyLimit)
    setTiersJson(defaultValues.ModelDailyLimitTiers)
    setGroupsJson(defaultValues.ModelDailyLimitGroups)
  }, [
    defaultValues.ModelDailyLimitEnabled,
    defaultValues.ModelDailyLimit,
    defaultValues.ModelDailyLimitTiers,
    defaultValues.ModelDailyLimitGroups,
  ])

  const entries = useMemo(
    () => configToEntries(parseConfig(configJson), parseTierConfig(tiersJson)),
    [configJson, tiersJson]
  )

  const sharedEntries = useMemo(
    () => sharedGroupsToEntries(parseSharedGroups(groupsJson)),
    [groupsJson]
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

  const persist = (
    nextEnabled: boolean,
    nextConfig: string,
    nextTiers: string,
    nextGroups: string
  ) => {
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
    if (nextTiers !== defaultValues.ModelDailyLimitTiers) {
      updates.push({ key: 'ModelDailyLimitTiers', value: nextTiers })
    }
    if (nextGroups !== defaultValues.ModelDailyLimitGroups) {
      updates.push({ key: 'ModelDailyLimitGroups', value: nextGroups })
    }
    return updates
  }

  const onSave = async () => {
    try {
      JSON.parse(groupsJson || '[]')
    } catch {
      return
    }
    const updates = persist(enabled, configJson, tiersJson, groupsJson)
    for (const u of updates) {
      await updateOption.mutateAsync(u)
    }
  }

  const handleSaveEntry = (data: DailyLimitEntry) => {
    const config = parseConfig(configJson)
    const tierConfig = parseTierConfig(tiersJson)
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
      if (tierConfig[editData.modelName]) {
        delete tierConfig[editData.modelName][editData.group]
        if (Object.keys(tierConfig[editData.modelName]).length === 0) {
          delete tierConfig[editData.modelName]
        }
      }
    }
    if (!config[data.modelName]) config[data.modelName] = {}
    config[data.modelName][data.group] = data.limit
    if (!tierConfig[data.modelName]) tierConfig[data.modelName] = {}
    tierConfig[data.modelName][data.group] = data.tiers
    setConfigJson(JSON.stringify(config))
    setTiersJson(JSON.stringify(tierConfig))
  }

  const handleSaveSharedEntry = (data: SharedLimitEntry) => {
    const groups = parseSharedGroups(groupsJson)
    let shared = groups.find((item) => item.name === sharedEditData?.sharedName)
    if (!shared) {
      shared = { name: data.sharedName, models: [], limits: {}, tiers: {} }
      groups.push(shared)
    }
    if (sharedEditData && sharedEditData.group !== data.group) {
      delete shared.limits[sharedEditData.group]
      delete shared.tiers?.[sharedEditData.group]
    }
    shared.name = data.sharedName
    shared.models = data.models
    shared.reset_hour = data.resetHour
    shared.limits[data.group] = data.limit
    if (!shared.tiers) shared.tiers = {}
    shared.tiers[data.group] = data.tiers
    setGroupsJson(JSON.stringify(groups))
  }

  const handleDeleteShared = (entry: SharedLimitEntry) => {
    const groups = parseSharedGroups(groupsJson)
    const shared = groups.find((item) => item.name === entry.sharedName)
    if (!shared) return
    delete shared.limits[entry.group]
    delete shared.tiers?.[entry.group]
    const next = groups.filter(
      (item) =>
        item.name !== entry.sharedName || Object.keys(item.limits).length > 0
    )
    setGroupsJson(JSON.stringify(next))
  }

  const handleDelete = (entry: DailyLimitEntry) => {
    const config = parseConfig(configJson)
    const tierConfig = parseTierConfig(tiersJson)
    if (config[entry.modelName]) {
      delete config[entry.modelName][entry.group]
      if (Object.keys(config[entry.modelName]).length === 0) {
        delete config[entry.modelName]
      }
    }
    if (tierConfig[entry.modelName]) {
      delete tierConfig[entry.modelName][entry.group]
      if (Object.keys(tierConfig[entry.modelName]).length === 0) {
        delete tierConfig[entry.modelName]
      }
    }
    setConfigJson(JSON.stringify(config))
    setTiersJson(JSON.stringify(tierConfig))
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

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <label className='text-sm font-medium'>
            {t('Shared limit groups')}
          </label>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              setSharedEditData(null)
              setSharedDialogOpen(true)
            }}
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add shared limit')}
          </Button>
        </div>
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Models')}</TableHead>
                <TableHead>{t('Group')}</TableHead>
                <TableHead className='text-right'>{t('Daily limit')}</TableHead>
                <TableHead>{t('Billing tiers')}</TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sharedEntries.map((entry) => (
                <TableRow key={`${entry.sharedName}::${entry.group}`}>
                  <TableCell className='max-w-80 truncate font-mono text-xs'>
                    {entry.models.join(', ')}
                  </TableCell>
                  <TableCell className='font-mono'>{entry.group}</TableCell>
                  <TableCell className='text-right font-mono'>
                    {entry.limit.toLocaleString()}
                  </TableCell>
                  <TableCell className='max-w-80 font-mono text-xs'>
                    {formatTiers(entry.tiers)}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setSharedEditData(entry)
                        setSharedDialogOpen(true)
                      }}
                    >
                      <Pencil className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => handleDeleteShared(entry)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

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
                <TableHead className='text-right'>{t('Daily limit')}</TableHead>
                <TableHead>{t('Billing tiers')}</TableHead>
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
                  <TableCell className='max-w-80 font-mono text-xs'>
                    {formatTiers(entry.tiers)}
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
      <SharedLimitDialog
        open={sharedDialogOpen}
        onOpenChange={setSharedDialogOpen}
        onSave={handleSaveSharedEntry}
        editData={sharedEditData}
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
  const [tiers, setTiers] = useState<DailyLimitTier[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (editData) {
      setModelName(editData.modelName)
      setGroup(editData.group)
      setLimit(editData.limit)
      setTiers(editData.tiers)
    } else {
      setModelName('')
      setGroup('')
      setLimit(300)
      setTiers([])
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
    const invalidTier = tiers.some(
      (tier) =>
        tier.from < 1 ||
        tier.to < tier.from ||
        tier.to > limit ||
        tier.multiplier <= 0
    )
    if (invalidTier) {
      setError(
        t(
          'Billing tiers must be within the daily limit and use a positive multiplier'
        )
      )
      return
    }
    const sortedTiers = [...tiers].sort((a, b) => a.from - b.from)
    if (
      sortedTiers.some(
        (tier, index) => index > 0 && tier.from <= sortedTiers[index - 1].to
      )
    ) {
      setError(t('Billing tiers cannot overlap'))
      return
    }
    onSave({
      modelName: modelName.trim(),
      group: group.trim(),
      limit,
      tiers: sortedTiers,
    })
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
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <label className='text-sm font-medium'>
                {t('Billing tiers')}
              </label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  setTiers([
                    ...tiers,
                    {
                      from: tiers.at(-1)?.to ? tiers.at(-1)!.to + 1 : 1,
                      to: limit,
                      multiplier: 1,
                    },
                  ])
                }
              >
                <Plus className='mr-1 h-3.5 w-3.5' />
                {t('Add tier')}
              </Button>
            </div>
            {tiers.map((tier, index) => (
              <div
                key={index}
                className='grid grid-cols-[1fr_1fr_1fr_auto] gap-2'
              >
                <Input
                  type='number'
                  min={1}
                  value={tier.from}
                  aria-label={t('From request')}
                  onChange={(event) => {
                    const next = [...tiers]
                    next[index] = {
                      ...tier,
                      from: parseInt(event.target.value) || 0,
                    }
                    setTiers(next)
                  }}
                />
                <Input
                  type='number'
                  min={1}
                  max={limit}
                  value={tier.to}
                  aria-label={t('To request')}
                  onChange={(event) => {
                    const next = [...tiers]
                    next[index] = {
                      ...tier,
                      to: parseInt(event.target.value) || 0,
                    }
                    setTiers(next)
                  }}
                />
                <Input
                  type='number'
                  min={0.01}
                  step={0.1}
                  value={tier.multiplier}
                  aria-label={t('Multiplier')}
                  onChange={(event) => {
                    const next = [...tiers]
                    next[index] = {
                      ...tier,
                      multiplier: parseFloat(event.target.value) || 0,
                    }
                    setTiers(next)
                  }}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() =>
                    setTiers(
                      tiers.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Ranges use request numbers, for example 1-3000 at 1x and 3001-5000 at 2x.'
              )}
            </p>
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
