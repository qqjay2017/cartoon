import { and, eq, ne } from 'drizzle-orm'
import type { BookSource } from '@cartoon/core'
import type { AppDb } from '../client.js'
import { sourceCookies, sources } from '../schema.js'

export interface LoadedDbSource extends BookSource {
  id: string
  fileName?: string
}

export async function listSources(db: AppDb, type?: 0 | 2) {
  const rows = await db.select().from(sources).orderBy(sources.name)
  return rows
    .filter(row => type === undefined || row.type === type)
    .map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as 0 | 2,
      enabled: row.enabled,
      fileName: row.fileName ?? undefined,
      url: (row.config as BookSource).bookSourceUrl,
      group: (row.config as BookSource).bookSourceGroup,
      cookieJar: Boolean((row.config as BookSource).enabledCookieJar),
    }))
}

export async function getEnabledSources(db: AppDb): Promise<LoadedDbSource[]> {
  const rows = await db.select().from(sources).where(eq(sources.enabled, true))
  return rows.map(row => ({
    ...(row.config as BookSource),
    id: row.id,
    fileName: row.fileName ?? undefined,
    enabled: row.enabled,
  }))
}

export async function getSourceById(db: AppDb, id: string): Promise<LoadedDbSource | null> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1)
  if (!row)
    return null
  return {
    ...(row.config as BookSource),
    id: row.id,
    fileName: row.fileName ?? undefined,
    enabled: row.enabled,
  }
}

export async function setSourceEnabled(db: AppDb, id: string, enabled: boolean) {
  await db.update(sources).set({ enabled, updatedAt: new Date() }).where(eq(sources.id, id))
}

export async function upsertSource(db: AppDb, id: string, source: BookSource, fileName?: string) {
  await db.insert(sources).values({
    id,
    name: source.bookSourceName,
    type: source.bookSourceType ?? 0,
    enabled: source.enabled !== false,
    config: source,
    fileName,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: sources.id,
    set: {
      name: source.bookSourceName,
      type: source.bookSourceType ?? 0,
      enabled: source.enabled !== false,
      config: source,
      fileName,
      updatedAt: new Date(),
    },
  })
}

export async function getSourceCookies(db: AppDb, sourceId: string): Promise<string> {
  const [row] = await db.select().from(sourceCookies).where(eq(sourceCookies.sourceId, sourceId)).limit(1)
  return row?.cookies ?? ''
}

export interface SourceRecord {
  id: string
  name: string
  type: 0 | 2
  enabled: boolean
  config: BookSource
  fileName?: string | null
  updatedAt: Date
}

export async function getSourceRecord(db: AppDb, id: string): Promise<SourceRecord | null> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1)
  if (!row)
    return null
  return {
    id: row.id,
    name: row.name,
    type: row.type as 0 | 2,
    enabled: row.enabled,
    config: row.config as BookSource,
    fileName: row.fileName,
    updatedAt: row.updatedAt,
  }
}

export async function listSourceRecords(db: AppDb): Promise<SourceRecord[]> {
  const rows = await db.select().from(sources).orderBy(sources.name)
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type as 0 | 2,
    enabled: row.enabled,
    config: row.config as BookSource,
    fileName: row.fileName,
    updatedAt: row.updatedAt,
  }))
}

export async function isSourceIdTaken(db: AppDb, id: string): Promise<boolean> {
  const [row] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, id)).limit(1)
  return Boolean(row)
}

export async function isSourceNameTaken(db: AppDb, name: string, excludeId?: string): Promise<boolean> {
  const condition = excludeId
    ? and(eq(sources.name, name), ne(sources.id, excludeId))
    : eq(sources.name, name)
  const [row] = await db.select({ id: sources.id }).from(sources).where(condition).limit(1)
  return Boolean(row)
}

export async function createSourceRecord(
  db: AppDb,
  input: { id: string, name: string, config: BookSource, enabled?: boolean },
): Promise<void> {
  const config: BookSource = {
    ...input.config,
    bookSourceName: input.name,
    bookSourceType: input.config.bookSourceType ?? 0,
    enabled: input.enabled !== false,
  }
  await db.insert(sources).values({
    id: input.id,
    name: input.name,
    type: config.bookSourceType ?? 0,
    enabled: input.enabled !== false,
    config,
    updatedAt: new Date(),
  })
}

export async function updateSourceRecord(
  db: AppDb,
  id: string,
  input: { name?: string, config?: BookSource, enabled?: boolean },
): Promise<void> {
  const existing = await getSourceRecord(db, id)
  if (!existing)
    throw new Error('source not found')

  const name = input.name ?? existing.name
  const config: BookSource = {
    ...(input.config ?? existing.config),
    bookSourceName: name,
    bookSourceType: (input.config?.bookSourceType ?? existing.config.bookSourceType) ?? 0,
    enabled: input.enabled ?? existing.enabled,
  }

  await db.update(sources).set({
    name,
    type: config.bookSourceType ?? 0,
    enabled: input.enabled ?? existing.enabled,
    config,
    updatedAt: new Date(),
  }).where(eq(sources.id, id))
}

export async function setSourceCookies(db: AppDb, sourceId: string, cookies: string) {
  await db.insert(sourceCookies).values({
    sourceId,
    cookies,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: sourceCookies.sourceId,
    set: { cookies, updatedAt: new Date() },
  })
}
