import { createHash } from 'node:crypto'

export function hashKey(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length)
}

export function sanitizePathSegment(name: string, max = 80): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'item'
}

export function normalizeUrl(url: string): string {
  try {
    return new URL(url).href
  }
  catch {
    return url
  }
}
