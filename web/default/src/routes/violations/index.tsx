/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Violations } from '@/features/violations'

const violationsSearchSchema = z.object({
  p: z.number().int().min(1).optional().catch(1),
})

export const Route = createFileRoute('/violations/')({
  validateSearch: violationsSearchSchema,
  component: Violations,
})
