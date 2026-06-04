import { hashKey, normalizeUrl } from '../cache/cache-keys.js'

const XS_BOOK_RE = /\/xs\/(\d+)\//i
const CHAPTER_HTML_RE = /\/(\d+)\.html?$/i
const TRAILING_NUM_RE = /\/(\d+)\/?$/

export function bookshelfId(sourceId: string, bookId: string): string {
  return `${sourceId}:${bookId}`
}

export function parseBookshelfId(id: string): { sourceId: string, bookId: string } | null {
  const colon = id.indexOf(':')
  if (colon <= 0)
    return null
  return {
    sourceId: id.slice(0, colon),
    bookId: id.slice(colon + 1),
  }
}

export function bookIdFromUrl(bookUrl: string, bookUrlPattern?: string): string {
  const normalized = normalizeUrl(bookUrl)

  const xsMatch = normalized.match(XS_BOOK_RE)
  if (xsMatch?.[1])
    return xsMatch[1]

  if (bookUrlPattern) {
    try {
      const re = new RegExp(bookUrlPattern, 'i')
      const match = normalized.match(re)
      if (match?.[1])
        return match[1]
      const digit = normalized.match(/(\d+)/)
      if (digit?.[1] && match)
        return digit[1]
    }
    catch {
      // invalid pattern
    }
  }

  const bookHtm = normalized.match(/\/book\/(\d+)/i)
  if (bookHtm?.[1])
    return bookHtm[1]

  return hashKey(normalized, 16)
}

export function chapterIdFromUrl(chapterUrl: string): string {
  const normalized = normalizeUrl(chapterUrl)

  const htmlMatch = normalized.match(CHAPTER_HTML_RE)
  if (htmlMatch?.[1])
    return htmlMatch[1]

  const trailing = normalized.match(TRAILING_NUM_RE)
  if (trailing?.[1])
    return trailing[1]

  return hashKey(normalized, 16)
}

export function enrichChapterIds<T extends { url: string, id?: string }>(chapters: T[]): (T & { id: string })[] {
  return chapters.map((ch) => {
    const id = ch.id ?? chapterIdFromUrl(ch.url)
    return { ...ch, id }
  })
}
