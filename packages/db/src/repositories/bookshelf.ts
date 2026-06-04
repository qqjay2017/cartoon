import { desc, eq } from 'drizzle-orm'
import type { AppDb } from '../client.js'
import { bookshelf } from '../schema.js'

export interface BookshelfRow {
  id: string
  sourceId: string
  bookId: string
  bookUrl: string
  name: string
  author?: string | null
  coverUrl?: string | null
  lastReadChapterId?: string | null
  lastReadChapterName?: string | null
  addedAt: number
}

export async function listBookshelf(db: AppDb): Promise<BookshelfRow[]> {
  const rows = await db.select().from(bookshelf).orderBy(desc(bookshelf.addedAt))
  return rows.map(row => ({
    id: row.id,
    sourceId: row.sourceId,
    bookId: row.bookId,
    bookUrl: row.bookUrl,
    name: row.name,
    author: row.author,
    coverUrl: row.coverUrl,
    lastReadChapterId: row.lastReadChapterId,
    lastReadChapterName: row.lastReadChapterName,
    addedAt: row.addedAt,
  }))
}

export async function getBookshelfItem(db: AppDb, id: string): Promise<BookshelfRow | null> {
  const [row] = await db.select().from(bookshelf).where(eq(bookshelf.id, id)).limit(1)
  if (!row)
    return null
  return {
    id: row.id,
    sourceId: row.sourceId,
    bookId: row.bookId,
    bookUrl: row.bookUrl,
    name: row.name,
    author: row.author,
    coverUrl: row.coverUrl,
    lastReadChapterId: row.lastReadChapterId,
    lastReadChapterName: row.lastReadChapterName,
    addedAt: row.addedAt,
  }
}

export async function addBookshelfItem(db: AppDb, item: BookshelfRow) {
  await db.insert(bookshelf).values({
    id: item.id,
    sourceId: item.sourceId,
    bookId: item.bookId,
    bookUrl: item.bookUrl,
    name: item.name,
    author: item.author,
    coverUrl: item.coverUrl,
    lastReadChapterId: item.lastReadChapterId,
    lastReadChapterName: item.lastReadChapterName,
    addedAt: item.addedAt,
  }).onConflictDoNothing()
}

export async function removeBookshelfItem(db: AppDb, id: string) {
  await db.delete(bookshelf).where(eq(bookshelf.id, id))
}

export async function updateBookshelfProgress(
  db: AppDb,
  id: string,
  chapterId: string,
  chapterName: string,
) {
  await db.update(bookshelf).set({
    lastReadChapterId: chapterId,
    lastReadChapterName: chapterName,
  }).where(eq(bookshelf.id, id))
}
