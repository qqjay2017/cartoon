import { and, asc, eq } from 'drizzle-orm'
import type { BookDetail, Chapter } from '@cartoon/core'
import type { AppDb } from '../client.js'
import { bookMeta, chapterContent, chapters } from '../schema.js'

export async function getBookMeta(db: AppDb, bookshelfId: string): Promise<{
  detail: BookDetail
  tocCachedAt?: Date | null
} | null> {
  const [row] = await db.select().from(bookMeta).where(eq(bookMeta.bookshelfId, bookshelfId)).limit(1)
  if (!row)
    return null
  return {
    detail: row.detail as BookDetail,
    tocCachedAt: row.tocCachedAt,
  }
}

export async function upsertBookMeta(db: AppDb, bookshelfId: string, detail: BookDetail) {
  await db.insert(bookMeta).values({
    bookshelfId,
    detail,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: bookMeta.bookshelfId,
    set: {
      detail,
      updatedAt: new Date(),
    },
  })
}

export async function setTocCachedAt(db: AppDb, bookshelfId: string, at: Date) {
  await db.insert(bookMeta).values({
    bookshelfId,
    detail: {},
    tocCachedAt: at,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: bookMeta.bookshelfId,
    set: { tocCachedAt: at, updatedAt: new Date() },
  })
}

export async function getChapterList(db: AppDb, bookshelfId: string): Promise<Chapter[]> {
  const rows = await db.select().from(chapters)
    .where(eq(chapters.bookshelfId, bookshelfId))
    .orderBy(asc(chapters.sortIndex))
  return rows.map(row => ({
    name: row.name,
    url: row.chapterUrl,
    updateTime: row.updateTime ?? undefined,
    id: row.chapterId,
  }))
}

export async function replaceChapterList(db: AppDb, bookshelfId: string, list: Chapter[]) {
  await db.delete(chapters).where(eq(chapters.bookshelfId, bookshelfId))
  if (list.length === 0)
    return

  await db.insert(chapters).values(
    list.map((ch, index) => ({
      bookshelfId,
      chapterId: ch.id ?? String(index),
      chapterUrl: ch.url,
      name: ch.name,
      sortIndex: index,
      updateTime: ch.updateTime,
    })),
  )
}

export async function getChapterContentRecord(
  db: AppDb,
  bookshelfId: string,
  chapterId: string,
) {
  const [row] = await db.select().from(chapterContent)
    .where(and(
      eq(chapterContent.bookshelfId, bookshelfId),
      eq(chapterContent.chapterId, chapterId),
    ))
    .limit(1)
  return row ?? null
}

export async function upsertChapterContentRecord(
  db: AppDb,
  bookshelfId: string,
  chapterId: string,
  filePath: string,
) {
  await db.insert(chapterContent).values({
    bookshelfId,
    chapterId,
    filePath,
    cachedAt: new Date(),
  }).onConflictDoUpdate({
    target: [chapterContent.bookshelfId, chapterContent.chapterId],
    set: { filePath, cachedAt: new Date() },
  })
}

export async function listCachedChapterIds(db: AppDb, bookshelfId: string): Promise<string[]> {
  const rows = await db.select({ chapterId: chapterContent.chapterId })
    .from(chapterContent)
    .where(eq(chapterContent.bookshelfId, bookshelfId))
  return rows.map(r => r.chapterId)
}
