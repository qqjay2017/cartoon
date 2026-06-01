import * as cheerio from 'cheerio'
import { isJsonContent } from './json-rules.js'
import { JsRuntime } from './js-runtime.js'
import { RuleEngine } from './rule-engine.js'
import { SourceSession } from './source-session.js'
import type {
  BookDetail,
  BookSource,
  Chapter,
  ChapterContent,
  SearchBook,
} from '../types/book-source.js'
import { type Fetcher } from '../utils/http.js'

export interface BookServiceOptions {
  fetcher: Fetcher
}

export class BookService {
  private jsRuntime = new JsRuntime()
  private sessions = new Map<string, SourceSession>()

  constructor(private options: BookServiceOptions) {}

  private getSession(source: BookSource & { id: string }): SourceSession {
    let session = this.sessions.get(source.id)
    if (!session) {
      session = new SourceSession(source)
      session.initJsLib((script, bindings) => this.jsRuntime.runScript(script, bindings))
      this.sessions.set(source.id, session)
    }
    return session
  }

  private createEngine(source: BookSource & { id: string }): RuleEngine {
    return new RuleEngine({
      jsRuntime: this.jsRuntime,
      session: this.getSession(source),
    })
  }

  private async resolveHeaders(source: BookSource & { id: string }, baseUrl: string): Promise<Record<string, string>> {
    const raw = source.header?.trim()
    if (!raw)
      return {}

    if (raw.startsWith('<js>'))
      return this.jsRuntime.evaluateHeader(raw, baseUrl, this.getSession(source))

    try {
      return JSON.parse(raw) as Record<string, string>
    }
    catch {
      return {}
    }
  }

  private resolveSearchUrl(source: BookSource & { id: string }, keyword: string, page = 1): string {
    if (!source.searchUrl)
      return ''

    return this.jsRuntime.resolveTemplate(
      source.searchUrl,
      { key: keyword, page, baseUrl: source.bookSourceUrl },
      this.getSession(source),
    )
  }

  async search(source: BookSource & { id: string }, keyword: string): Promise<SearchBook[]> {
    if (!source.searchUrl || !source.ruleSearch?.bookList)
      return []

    const searchUrl = this.resolveSearchUrl(source, keyword)
    const html = await this.options.fetcher(searchUrl, {
      headers: await this.resolveHeaders(source, searchUrl),
    })

    const engine = this.createEngine(source)
    const ctx = { baseUrl: searchUrl }
    const $ = cheerio.load(html)
    const list = engine.parseList(html, source.ruleSearch.bookList, ctx)
    const results: SearchBook[] = []

    list.each((_, node) => {
      const $item = $(node)
      const getField = (rule?: string) =>
        rule ? engine.parseElement($item, rule, ctx) : undefined

      const name = getField(source.ruleSearch?.name)
      let bookUrl = getField(source.ruleSearch?.bookUrl)
      if (!name || !bookUrl)
        return

      if (!/^https?:\/\//i.test(bookUrl))
        bookUrl = new URL(bookUrl, searchUrl).href

      results.push({
        sourceId: source.id,
        sourceName: source.bookSourceName,
        sourceType: source.bookSourceType,
        name,
        author: getField(source.ruleSearch?.author),
        intro: getField(source.ruleSearch?.intro),
        kind: getField(source.ruleSearch?.kind),
        lastChapter: getField(source.ruleSearch?.lastChapter),
        wordCount: getField(source.ruleSearch?.wordCount),
        coverUrl: getField(source.ruleSearch?.coverUrl),
        bookUrl,
      })
    })

    return results
  }

  async getBookDetail(source: BookSource & { id: string }, bookUrl: string): Promise<BookDetail> {
    const html = await this.options.fetcher(bookUrl, {
      headers: await this.resolveHeaders(source, bookUrl),
    })

    const engine = this.createEngine(source)
    const baseCtx = { baseUrl: bookUrl, content: html, src: html }
    const rules = source.ruleBookInfo ?? {}

    const name = engine.evaluate(rules.name, baseCtx) || '未知'
    const author = engine.evaluate(rules.author, { ...baseCtx, book: { name } }) || undefined
    const kind = engine.evaluate(rules.kind, { ...baseCtx, book: { name, author } }) || undefined
    const book = { name, author, kind, bookUrl }

    return {
      sourceId: source.id,
      sourceName: source.bookSourceName,
      sourceType: source.bookSourceType,
      bookUrl,
      name,
      author,
      intro: engine.evaluate(rules.intro, { ...baseCtx, book }) || undefined,
      kind,
      lastChapter: engine.evaluate(rules.lastChapter, { ...baseCtx, book }) || undefined,
      wordCount: engine.evaluate(rules.wordCount, { ...baseCtx, book }) || undefined,
      coverUrl: engine.evaluate(rules.coverUrl, { ...baseCtx, book }) || undefined,
      tocUrl: engine.evaluate(rules.tocUrl, { ...baseCtx, book }) || bookUrl,
    }
  }

  async getToc(source: BookSource & { id: string }, tocUrl: string): Promise<Chapter[]> {
    if (!source.ruleToc?.chapterList)
      return []

    const resolvedTocUrl = /^https?:\/\//i.test(tocUrl)
      ? tocUrl
      : new URL(tocUrl, source.bookSourceUrl).href

    const session = this.getSession(source)
    const midFromTocUrl = resolvedTocUrl.match(/[?&]mid=(\d+)/)?.[1]
    if (midFromTocUrl)
      session.javaPut('mid', midFromTocUrl)

    const content = await this.options.fetcher(resolvedTocUrl, {
      headers: await this.resolveHeaders(source, resolvedTocUrl),
    })

    const engine = this.createEngine(source)
    const ctx = { baseUrl: resolvedTocUrl, content, src: content }

    if (isJsonContent(content)) {
      const items = engine.parseJsonList(content, source.ruleToc.chapterList)
      return items.map((item) => {
        const name = engine.parseJsonItem(item, source.ruleToc?.chapterName, ctx)
        let url = engine.parseJsonItem(item, source.ruleToc?.chapterUrl, { ...ctx, jsonItem: item })
        if (url && !/^https?:\/\//i.test(url))
          url = new URL(url, source.bookSourceUrl).href

        return {
          name,
          url,
          updateTime: source.ruleToc?.updateTime
            ? engine.parseJsonItem(item, source.ruleToc.updateTime, ctx)
            : undefined,
        }
      }).filter(chapter => chapter.name && chapter.url)
    }

    const $ = cheerio.load(content)
    const list = engine.parseList(content, source.ruleToc.chapterList, { baseUrl: resolvedTocUrl })
    const chapters: Chapter[] = []

    list.each((_, node) => {
      const $item = $(node)
      const name = source.ruleToc?.chapterName
        ? engine.parseElement($item, source.ruleToc.chapterName, { baseUrl: resolvedTocUrl })
        : $item.text().trim()

      let url = ''
      if (source.ruleToc?.chapterUrl) {
        url = engine.parseElement($item, source.ruleToc.chapterUrl, { baseUrl: resolvedTocUrl })
      }
      else {
        url = $item.find('a').attr('href') ?? $item.attr('href') ?? ''
        url = url.startsWith('http') ? url : new URL(url, resolvedTocUrl).href
      }

      if (name && url) {
        chapters.push({
          name,
          url,
          updateTime: source.ruleToc?.updateTime
            ? engine.parseElement($item, source.ruleToc.updateTime, { baseUrl: resolvedTocUrl })
            : undefined,
        })
      }
    })

    return chapters
  }

  async getChapterContent(
    source: BookSource & { id: string },
    chapterUrl: string,
  ): Promise<ChapterContent> {
    const resolvedUrl = /^https?:\/\//i.test(chapterUrl)
      ? chapterUrl
      : new URL(chapterUrl, source.bookSourceUrl).href

    const content = await this.options.fetcher(resolvedUrl, {
      headers: await this.resolveHeaders(source, resolvedUrl),
    })

    const engine = this.createEngine(source)
    const rule = source.ruleContent?.content
    const html = engine.evaluate(rule, {
      baseUrl: resolvedUrl,
      content,
      src: content,
      result: content,
    })

    if (source.bookSourceType === 2) {
      const normalizedHtml = html.replace(/<\s+img/gi, '<img')
      let images: string[] = []

      if (normalizedHtml.trim()) {
        const $ = cheerio.load(normalizedHtml)
        images = $('img')
          .map((_, img) => {
            const src = $(img).attr('src') ?? $(img).attr('data-original') ?? ''
            if (!src || src.includes('app_logo') || src.includes('/images/logo'))
              return ''
            return src.startsWith('http') ? src : new URL(src, resolvedUrl).href
          })
          .get()
          .filter(Boolean)
      }

      if (!images.length && isJsonContent(content)) {
        try {
          const data = JSON.parse(content) as {
            data?: { info?: { images?: { images?: Array<{ url?: string }> } } }
          }
          const list = data.data?.info?.images?.images ?? []
          images = list
            .map(item => item.url ? `https://f40-1-4.g-mh.online${item.url}` : '')
            .filter(Boolean)
        }
        catch {
          // ignore
        }
      }

      if (images.length)
        return { images }
    }

    return { text: html || content }
  }
}
