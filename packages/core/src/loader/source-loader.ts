import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BookSource } from '../types/book-source.js'

export interface LoadedSource extends BookSource {
  id: string
  fileName?: string
}

export async function loadSourcesFromDir(dir: string): Promise<LoadedSource[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const sources: LoadedSource[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json'))
      continue

    const content = await readFile(join(dir, entry.name), 'utf8')
    const parsed = JSON.parse(content) as BookSource | BookSource[]
    const list = Array.isArray(parsed) ? parsed : [parsed]

    for (const source of list) {
      if (source.enabled === false)
        continue

      const id = entry.name.replace(/\.json$/i, '')
      sources.push({
        ...source,
        id,
        fileName: entry.name,
      })
    }
  }

  return sources.sort((a, b) => a.bookSourceName.localeCompare(b.bookSourceName))
}
