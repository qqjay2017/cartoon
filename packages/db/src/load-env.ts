import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseEnvFile(content: string) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0)
      continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
      value = value.slice(1, -1)
    if (process.env[key] === undefined)
      process.env[key] = value
  }
}

/** 从 monorepo 根目录加载 .env（migrate/seed 在 packages/db 下执行时也能读到） */
export function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const envPath = join(dir, '.env')
    if (existsSync(envPath)) {
      parseEnvFile(readFileSync(envPath, 'utf8'))
      return
    }
    const parent = dirname(dir)
    if (parent === dir)
      break
    dir = parent
  }
}

loadRootEnv()
