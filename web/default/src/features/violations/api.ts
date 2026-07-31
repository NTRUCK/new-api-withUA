/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api } from '@/lib/api'

export interface PublicViolation {
  display_name: string
  discord_username: string
  avatar_url: string
  reason: string
  hit_count: number
  first_recorded_at: number
  last_recorded_at: number
}

export interface ViolationsResponse {
  success: boolean
  message?: string
  data?: {
    items: PublicViolation[]
    total: number
    page: number
    page_size: number
  }
}

export async function getPublicViolations(page: number, pageSize = 12) {
  const res = await api.get<ViolationsResponse>('/api/violations', {
    params: { p: page, page_size: pageSize },
  })
  if (!res.data.success) {
    throw new Error(res.data.message || 'Unable to load violations')
  }
  return res.data
}
