import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ComicCacheService } from '../cache/comic-cache-service.js'
import type { Chapter } from '../types/book-source.js'

const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')

export interface CbzFileEntry {
  path: string
  name: string
}

export async function buildCbzToFile(entries: CbzFileEntry[], outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 0 } })

    archive.on('error', reject)
    output.on('error', reject)
    output.on('close', resolve)
    archive.pipe(output)

    for (const entry of entries)
      archive.file(entry.path, { name: entry.name })

    void archive.finalize()
  })
}

export async function buildCbzFromCache(
  comicCache: ComicCacheService,
  sourceId: string,
  bookUrl: string,
  chapters: Chapter[],
  outputPath: string,
): Promise<void> {
  const entries: CbzFileEntry[] = []
  let pageIndex = 0

  for (const chapter of chapters) {
    const files = await comicCache.listChapterFiles(sourceId, bookUrl, chapter.url)
    if (!files?.length)
      throw new Error(`章节未缓存：${chapter.name}`)

    const chapterDir = comicCache.getChapterDir(sourceId, bookUrl, chapter.url)
    for (const file of files) {
      pageIndex++
      const ext = file.split('.').pop() ?? 'jpg'
      entries.push({
        path: join(chapterDir, file),
        name: `${String(pageIndex).padStart(3, '0')}.${ext}`,
      })
    }
  }

  if (!entries.length)
    throw new Error('未获取到漫画图片')

  await buildCbzToFile(entries, outputPath)
}
