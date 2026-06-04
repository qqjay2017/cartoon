import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BookSource } from '@cartoon/core'
import { closeDb, createDb } from './client.js'
import { sources } from './schema.js'

const SKIP_FILES = new Set(['69shuba.json'])

async function seedFromDir(remoteDir: string) {
  const { db, sql } = createDb()
  const entries = await readdir(remoteDir, { withFileTypes: true })
  let count = 0

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || SKIP_FILES.has(entry.name))
      continue

    const id = basename(entry.name, '.json')
    const raw = await readFile(join(remoteDir, entry.name), 'utf8')
    const parsed = JSON.parse(raw) as BookSource | BookSource[]
    const list = Array.isArray(parsed) ? parsed : [parsed]

    for (const source of list) {
      await db.insert(sources).values({
        id,
        name: source.bookSourceName,
        type: source.bookSourceType ?? 0,
        enabled: source.enabled !== false,
        config: source,
        fileName: entry.name,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: sources.id,
        set: {
          name: source.bookSourceName,
          type: source.bookSourceType ?? 0,
          enabled: source.enabled !== false,
          config: source,
          fileName: entry.name,
          updatedAt: new Date(),
        },
      })
      count++
      console.log(`[db] Seeded source: ${id}`)
    }
  }

  await closeDb()
  console.log(`[db] Seed complete (${count} sources)`)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const defaultRemote = join(__dirname, '../../../remote')
const remoteDir = process.argv[2] ?? defaultRemote
seedFromDir(remoteDir).catch((error) => {
  console.error('[db] Seed failed:', error)
  process.exit(1)
})
