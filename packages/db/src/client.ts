import './load-env.js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let client: ReturnType<typeof postgres> | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to the project root as .env, or export DATABASE_URL.',
    )
  }
  return url
}

export function createDb(connectionString = getDatabaseUrl()) {
  const sql = postgres(connectionString, { max: 10 })
  return { sql, db: drizzle(sql, { schema }) }
}

export function getDb() {
  if (!db) {
    const created = createDb()
    client = created.sql
    db = created.db
  }
  return { sql: client!, db }
}

export async function closeDb() {
  if (client) {
    await client.end()
    client = undefined
    db = undefined
  }
}

export type AppDb = ReturnType<typeof createDb>['db']
