/**
 * 一次性迁移旧 cache/novels 布局到新 content/{bookshelfId}/{chapterId}.json
 * 用法: DATABASE_URL=... pnpm exec tsx scripts/migrate-cache.ts
 */
import { access, copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  bookIdFromUrl,
  bookshelfId,
  chapterIdFromUrl,
  type BookDetail,
} from '@cartoon/core'
import {
  addBookshelfItem,
  createDb,
  closeDb,
  getSourceById,
  replaceChapterList,
  upsertBookMeta,
  upsertChapterContentRecord,
} from '@cartoon/db'

const root = join(import.meta.dirname, '..')
const legacyRoot = join(root, 'cache', 'novels')

async function main() {
  const { db } = createDb()
  let migrated = 0
  let skipped = 0

  const sourceDirs = await readdir(legacyRoot, { withFileTypes: true }).catch(() => [])
  for (const sourceDir of sourceDirs) {
    if (!sourceDir.isDirectory())
      continue

    const legacySourceName = sourceDir.name
    const books = await readdir(join(legacyRoot, legacySourceName), { withFileTypes: true })
    for (const bookDir of books) {
      if (!bookDir.isDirectory())
        continue

      const bookPath = join(legacyRoot, legacySourceName, bookDir.name)
      let bookJson: BookDetail | null = null
      try {
        bookJson = JSON.parse(await readFile(join(bookPath, 'book.json'), 'utf8')) as BookDetail
      }
      catch {
        skipped++
        continue
      }

      const sourceId = bookJson.sourceId || legacySourceName
      const source = await getSourceById(db, sourceId)
      if (!source) {
        console.warn(`[skip] unknown source ${sourceId} for ${bookJson.bookUrl}`)
        skipped++
        continue
      }

      const bookId = bookIdFromUrl(bookJson.bookUrl, source.bookUrlPattern)
      const id = bookshelfId(sourceId, bookId)

      await addBookshelfItem(db, {
        id,
        sourceId,
        bookId,
        bookUrl: bookJson.bookUrl,
        name: bookJson.name,
        author: bookJson.author,
        coverUrl: bookJson.coverUrl,
        addedAt: Date.now(),
      })
      await upsertBookMeta(db, id, bookJson)

      let toc: Array<{ name: string, url: string, id?: string }> = []
      try {
        const tocRaw = JSON.parse(await readFile(join(bookPath, 'toc.json'), 'utf8')) as { chapters?: typeof toc }
        toc = tocRaw.chapters ?? []
      }
      catch {
        // no toc
      }

      const enriched = toc.map((ch, i) => ({
        ...ch,
        id: ch.id ?? chapterIdFromUrl(ch.url),
        sortIndex: i,
      }))
      if (enriched.length)
        await replaceChapterList(db, id, enriched)

      const chaptersDir = join(bookPath, 'chapters')
      try {
        const chapterDirs = await readdir(chaptersDir, { withFileTypes: true })
        for (const chDir of chapterDirs) {
          if (!chDir.isDirectory())
            continue
          const contentPath = join(chaptersDir, chDir.name, 'content.json')
          try {
            await access(contentPath)
          }
          catch {
            continue
          }

          const raw = JSON.parse(await readFile(contentPath, 'utf8')) as { url?: string, text?: string }
          const chapterUrl = raw.url ?? enriched.find(c => c.id === chDir.name)?.url
          if (!chapterUrl)
            continue

          const chId = chapterIdFromUrl(chapterUrl)
          const safeId = id.replace(/:/g, '_')
          const destDir = join(root, 'cache', 'content', safeId)
          await mkdir(destDir, { recursive: true })
          const dest = join(destDir, `${chId}.json`)
          await copyFile(contentPath, dest)
          await upsertChapterContentRecord(db, id, chId, `content/${safeId}/${chId}.json`)
        }
      }
      catch {
        // no chapters dir
      }

      migrated++
      console.log(`[ok] ${id}`)
    }
  }

  await closeDb()
  console.log(`Done. migrated=${migrated} skipped=${skipped}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
