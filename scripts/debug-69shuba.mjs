#!/usr/bin/env node
/**
 * 调试 69书吧书源（需代理时先 export HTTP_PROXY）
 * 用法: node scripts/debug-69shuba.mjs [bookUrl] [chapterUrl]
 */
import { BookService, loadSourcesFromDir } from '@cartoon/core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bookUrl = process.argv[2] ?? 'https://www.69shuba.com/book/89878.htm'
const chapterUrl = process.argv[3] ?? 'https://www.69shuba.com/txt/89878/40989799'

const fetcher = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Referer: 'https://www.69shuba.com/',
      ...options.headers,
    },
    method: options.method ?? 'GET',
    body: options.body,
  })
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (options.responseCharset === 'gbk') {
    const iconv = (await import('iconv-lite')).default
    return iconv.decode(buf, 'gbk')
  }
  return buf.toString('utf8')
}

const sources = await loadSourcesFromDir(join(root, 'remote'))
const source = sources.find(s => s.bookSourceName.includes('69'))
if (!source) {
  console.error('69书吧 source not found or disabled')
  process.exit(1)
}

const bookService = new BookService({ fetcher })

console.log('=== book detail ===')
try {
  const detail = await bookService.getBookDetail(source, bookUrl)
  console.log({ name: detail.name, author: detail.author, tocUrl: detail.tocUrl, lastChapter: detail.lastChapter })
}
catch (e) {
  console.error('detail failed:', e)
  process.exit(1)
}

console.log('\n=== toc (first 3) ===')
try {
  const toc = await bookService.getToc(source, bookUrl)
  console.log(`total ${toc.length}`, toc.slice(0, 3))
}
catch (e) {
  console.error('toc failed:', e)
}

console.log('\n=== chapter preview ===')
try {
  const ch = await bookService.getChapterContent(source, chapterUrl)
  console.log('text length:', ch.text?.length ?? 0, 'preview:', ch.text?.slice(0, 120))
}
catch (e) {
  console.error('chapter failed:', e)
}

console.log('\n=== search test ===')
try {
  const results = await bookService.search(source, '斗破')
  console.log(`search ${results.length}`, results.slice(0, 2).map(r => ({ name: r.name, bookUrl: r.bookUrl })))
}
catch (e) {
  console.error('search failed:', e)
}
