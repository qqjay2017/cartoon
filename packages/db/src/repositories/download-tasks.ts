import { and, asc, eq, notInArray } from 'drizzle-orm'
import type { AppDb } from '../client.js'
import { downloadTasks } from '../schema.js'

export type DownloadTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'

export interface DownloadTaskRecord {
  id: string
  bookshelfId: string
  chapterId: string
  chapterName: string
  chapterUrl: string
  sortIndex: number
  status: DownloadTaskStatus
  error: string | null
  createdAt: Date
  updatedAt: Date
}

function rowToRecord(row: typeof downloadTasks.$inferSelect): DownloadTaskRecord {
  return {
    id: row.id,
    bookshelfId: row.bookshelfId,
    chapterId: row.chapterId,
    chapterName: row.chapterName,
    chapterUrl: row.chapterUrl,
    sortIndex: row.sortIndex,
    status: row.status as DownloadTaskStatus,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listDownloadTasks(
  db: AppDb,
  bookshelfId: string,
): Promise<DownloadTaskRecord[]> {
  const rows = await db.select().from(downloadTasks)
    .where(eq(downloadTasks.bookshelfId, bookshelfId))
    .orderBy(asc(downloadTasks.sortIndex))
  return rows.map(rowToRecord)
}

/** Upsert chapter tasks. Completed tasks are never downgraded; others are reset to pending. */
export async function upsertDownloadTasks(
  db: AppDb,
  tasks: Array<{
    id: string
    bookshelfId: string
    chapterId: string
    chapterName: string
    chapterUrl: string
    sortIndex: number
    status: DownloadTaskStatus
  }>,
): Promise<void> {
  if (!tasks.length)
    return
  const now = new Date()
  for (const task of tasks) {
    await db.insert(downloadTasks).values({
      ...task,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: downloadTasks.id,
      set: {
        // Keep completed; reset everything else to provided status
        status: task.status,
        error: null,
        updatedAt: now,
      },
      setWhere: notInArray(downloadTasks.status, ['completed']),
    })
  }
}

export async function updateDownloadTaskStatus(
  db: AppDb,
  id: string,
  status: DownloadTaskStatus,
  error?: string | null,
): Promise<void> {
  await db.update(downloadTasks)
    .set({ status, error: error ?? null, updatedAt: new Date() })
    .where(eq(downloadTasks.id, id))
}

export async function pausePendingTasks(db: AppDb, bookshelfId: string): Promise<void> {
  await db.update(downloadTasks)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(
      eq(downloadTasks.bookshelfId, bookshelfId),
      eq(downloadTasks.status, 'pending'),
    ))
}

/** Also reset running→paused (chapter was in-flight when paused) */
export async function pauseActiveTasks(db: AppDb, bookshelfId: string): Promise<void> {
  await db.update(downloadTasks)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(
      eq(downloadTasks.bookshelfId, bookshelfId),
      notInArray(downloadTasks.status, ['completed', 'failed']),
    ))
}

export async function resumePausedTasks(db: AppDb, bookshelfId: string): Promise<void> {
  await db.update(downloadTasks)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(and(
      eq(downloadTasks.bookshelfId, bookshelfId),
      eq(downloadTasks.status, 'paused'),
    ))
}

export async function retryFailedTasks(db: AppDb, bookshelfId: string): Promise<void> {
  await db.update(downloadTasks)
    .set({ status: 'pending', error: null, updatedAt: new Date() })
    .where(and(
      eq(downloadTasks.bookshelfId, bookshelfId),
      eq(downloadTasks.status, 'failed'),
    ))
}

export async function markRunningTasksAsPending(db: AppDb, bookshelfId: string): Promise<void> {
  await db.update(downloadTasks)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(and(
      eq(downloadTasks.bookshelfId, bookshelfId),
      eq(downloadTasks.status, 'running'),
    ))
}

export async function clearDownloadTasks(db: AppDb, bookshelfId: string): Promise<void> {
  await db.delete(downloadTasks).where(eq(downloadTasks.bookshelfId, bookshelfId))
}
