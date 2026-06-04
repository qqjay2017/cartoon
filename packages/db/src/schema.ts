import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: integer('type').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').notNull(),
  fileName: text('file_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bookshelf = pgTable('bookshelf', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => sources.id),
  bookId: text('book_id').notNull(),
  bookUrl: text('book_url').notNull(),
  name: text('name').notNull(),
  author: text('author'),
  coverUrl: text('cover_url'),
  lastReadChapterId: text('last_read_chapter_id'),
  lastReadChapterName: text('last_read_chapter_name'),
  addedAt: bigint('added_at', { mode: 'number' }).notNull(),
})

export const bookMeta = pgTable('book_meta', {
  bookshelfId: text('bookshelf_id').primaryKey().references(() => bookshelf.id, { onDelete: 'cascade' }),
  detail: jsonb('detail').notNull(),
  tocCachedAt: timestamp('toc_cached_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const chapters = pgTable('chapters', {
  bookshelfId: text('bookshelf_id').notNull().references(() => bookshelf.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull(),
  chapterUrl: text('chapter_url').notNull(),
  name: text('name').notNull(),
  sortIndex: integer('sort_index').notNull(),
  updateTime: text('update_time'),
}, table => [
  primaryKey({ columns: [table.bookshelfId, table.chapterId] }),
])

export const chapterContent = pgTable('chapter_content', {
  bookshelfId: text('bookshelf_id').notNull().references(() => bookshelf.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull(),
  filePath: text('file_path').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.bookshelfId, table.chapterId] }),
])

export const sourceCookies = pgTable('source_cookies', {
  sourceId: text('source_id').primaryKey().references(() => sources.id, { onDelete: 'cascade' }),
  cookies: text('cookies').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
