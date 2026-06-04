import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb, closeDb } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const { db, sql } = createDb()
  const migrationsFolder = join(__dirname, '../drizzle')
  console.log('[db] Running migrations from', migrationsFolder)
  await migrate(db, { migrationsFolder })
  await closeDb()
  console.log('[db] Migrations complete')
}

main().catch((error) => {
  console.error('[db] Migration failed:', error)
  process.exit(1)
})
