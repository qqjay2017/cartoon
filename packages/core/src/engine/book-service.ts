import * as cheerio from 'cheerio'
import { isJsonContent } from './json-rules.js'
import { isJsRule, JsRuntime } from './js-runtime.js'
import { RuleEngine } from './rule-engine.js'
import { SourceSession } from './source-session.js'
import type {
  BookDetail,
  BookSource,
  Chapter,
  ChapterContent,
  SearchBook,
} from '../types/book-source.js'
import {
  isDirectBookUrl,
  parseLegadoSearchSpec,
  shouldSkipJsRuleParsing,
  type LegadoSearchRequest,
} from '../utils/legado-search.js'
import { type Fetcher } from '../utils/http.js'
import {
  applyLegadoReplaceRegex,
  isSameChapterNextPage,
  sanitizeNovelHtml,
} from '../utils/novel-content.js'

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

  private bookContext(book: BookState, source: BookSource & { id: string }) {
    return {
      ...book,
      origin: source.bookSourceUrl,
    }
  }

  private inferResponseCharset(source: BookSource & { id: string }): string | undefined {
    if (source.searchUrl?.toLowerCase().includes('gbk'))
      return 'gbk'
    return undefined
  }

  private async fetchSourceText(
    source: BookSource & { id: string },
    url: string,
    extraHeaders?: Record<string, string>,
  ): Promise<string> {
    return this.options.fetcher(url, {
      headers: {
        ...await this.resolveHeaders(source, url),
        ...extraHeaders,
      },
      responseCharset: this.inferResponseCharset(source),
      cookieJarKey: source.enabledCookieJar ? source.id : undefined,
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

  private resolveSearchRequest(
    source: BookSource & { id: string },
    keyword: string,
    page = 1,
  ): LegadoSearchRequest {
    if (!source.searchUrl)
      return { url: '' }

    const session = this.getSession(source)
    let spec = source.searchUrl

    if (isJsRule(spec)) {
      const script = spec.trim().startsWith('@js:')
        ? spec.trim().slice(4).trim()
        : spec.match(/^<js>([\s\S]*)<\/js>/i)?.[1]?.trim() ?? ''
      spec = String(this.jsRuntime.evaluateExpression(script, {
        key: keyword,
        page,
        baseUrl: source.bookSourceUrl,
        source: session.createSourceProxy(),
        java: session.createJavaApi(''),
      }) ?? '')
    }
    else {
      spec = this.jsRuntime.resolveTemplate(
        spec,
        { key: keyword, page, baseUrl: source.bookSourceUrl },
        session,
      )
    }

    if (!spec || /^https?:\/\//i.test(spec))
      return { url: spec }

    if (shouldSkipJsRuleParsing(spec) || !spec.includes(','))
      return { url: spec }

    return parseLegadoSearchSpec(spec, source.bookSourceUrl, { key: keyword, page })
  }

  private async fetchForSearch(
    source: BookSource & { id: string },
    request: LegadoSearchRequest,
  ): Promise<string> {
    const headers = {
      ...await this.resolveHeaders(source, request.url),
      ...request.headers,
    }

    return this.options.fetcher(request.url, {
      headers,
      method: request.method,
      body: request.body,
      responseCharset: request.responseCharset,
      cookieJarKey: source.enabledCookieJar ? source.id : undefined,
    })
  }

  async search(source: BookSource & { id: string }, keyword: string): Promise<SearchBook[]> {
    const trimmed = keyword.trim()
    if (!trimmed)
      return []

    if (isDirectBookUrl(trimmed))
      return this.searchByDirectUrl(source, trimmed)

    if (!source.searchUrl || !source.ruleSearch?.bookList)
      return []

    const request = this.resolveSearchRequest(source, trimmed)
    if (!request.url)
      return []

    const html = await this.fetchForSearch(source, request)
    return this.parseSearchResults(source, html, request.url)
  }

  async openByUrl(source: BookSource & { id: string }, bookUrl: string): Promise<BookDetail> {
    return this.getBookDetail(source, bookUrl.trim())
  }

  private async searchByDirectUrl(source: BookSource & { id: string }, bookUrl: string): Promise<SearchBook[]> {
    try {
      const detail = await this.getBookDetail(source, bookUrl)
      return [{
        sourceId: detail.sourceId,
        sourceName: detail.sourceName,
        sourceType: detail.sourceType,
        name: detail.name,
        author: detail.author,
        intro: detail.intro,
        kind: detail.kind,
        lastChapter: detail.lastChapter,
        wordCount: detail.wordCount,
        coverUrl: detail.coverUrl,
        bookUrl: detail.bookUrl,
      }]
    }
    catch {
      return []
    }
  }

  private parseSearchResults(
    source: BookSource & { id: string },
    html: string,
    searchUrl: string,
  ): SearchBook[] {
    const engine = this.createEngine(source)
    const ctx = { baseUrl: searchUrl }
    const $ = cheerio.load(html)
    const list = engine.parseList(html, source.ruleSearch!.bookList, ctx)
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
    const html = await this.fetchSourceText(source, bookUrl)

    const engine = this.createEngine(source)
    const baseCtx = { baseUrl: bookUrl, content: html, src: html }
    const rules = source.ruleBookInfo ?? {}

    const name = engine.evaluate(rules.name, baseCtx) || '未知'
    const author = engine.evaluate(rules.author, { ...baseCtx, book: { name, origin: source.bookSourceUrl } }) || undefined
    const kind = engine.evaluate(rules.kind, { ...baseCtx, book: { name, author, origin: source.bookSourceUrl } }) || undefined
    const book = this.bookContext({ name, author, kind, bookUrl }, source)

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

    let resolvedTocUrl = /^https?:\/\//i.test(tocUrl)
      ? tocUrl
      : new URL(tocUrl, source.bookSourceUrl).href

    let bookPageHtml = ''
    const tocUrlBeforeResolve = resolvedTocUrl

    if (source.ruleBookInfo?.tocUrl && !isResolvedTocApiUrl(resolvedTocUrl)) {
      const engine = this.createEngine(source)
      bookPageHtml = await this.fetchSourceText(source, resolvedTocUrl)

      const normalized = engine.evaluate(source.ruleBookInfo.tocUrl, {
        baseUrl: resolvedTocUrl,
        content: bookPageHtml,
        src: bookPageHtml,
      })
      if (normalized) {
        resolvedTocUrl = /^https?:\/\//i.test(normalized)
          ? normalized
          : new URL(normalized, source.bookSourceUrl).href
      }
    }

    const session = this.getSession(source)
    const midFromTocUrl = resolvedTocUrl.match(/[?&]mid=(\d+)/)?.[1]
    if (midFromTocUrl)
      session.javaPut('mid', midFromTocUrl)

    const content = bookPageHtml && resolvedTocUrl === tocUrlBeforeResolve
      ? bookPageHtml
      : await this.fetchSourceText(source, resolvedTocUrl)

    const engine = this.createEngine(source)
    const ctx = { baseUrl: resolvedTocUrl, content, src: content }
    const reverseOrder = source.ruleToc.chapterList.includes('[-1:0]')

    if (isJsonContent(content)) {
      const items = engine.parseJsonList(content, source.ruleToc.chapterList)
      const chapters = items.map((item) => {
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

      return reverseOrder ? chapters.reverse() : chapters
    }

    const $ = cheerio.load(content)
    const listRule = source.ruleToc.chapterList.replace('[-1:0]', '')
    const list = engine.parseList(content, listRule, { baseUrl: resolvedTocUrl })
    const drafts: Array<{ chapter: Chapter, dataNum?: number }> = []

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
        const dataNumRaw = $item.closest('li').attr('data-num')
        const dataNum = dataNumRaw ? Number(dataNumRaw) : undefined
        drafts.push({
          chapter: {
            name,
            url,
            updateTime: source.ruleToc?.updateTime
              ? engine.parseElement($item, source.ruleToc.updateTime, { baseUrl: resolvedTocUrl })
              : undefined,
          },
          dataNum: Number.isFinite(dataNum) ? dataNum : undefined,
        })
      }
    })

    if (drafts.length > 1 && drafts.every(item => item.dataNum !== undefined))
      drafts.sort((a, b) => a.dataNum! - b.dataNum!)
    else if (reverseOrder)
      drafts.reverse()

    return drafts.map(item => item.chapter)
  }

  async getChapterContent(
    source: BookSource & { id: string },
    chapterUrl: string,
  ): Promise<ChapterContent> {
    const resolvedUrl = /^https?:\/\//i.test(chapterUrl)
      ? chapterUrl
      : new URL(chapterUrl, source.bookSourceUrl).href

    let content = await this.fetchSourceText(source, resolvedUrl)

    const engine = this.createEngine(source)
    const rule = source.ruleContent?.content
    const ruleCtx = {
      baseUrl: resolvedUrl,
      content,
      src: content,
      result: content,
    }
    let html = engine.evaluate(rule, ruleCtx)

    const nextContentRule = source.ruleContent?.nextContentUrl
    if (nextContentRule && source.bookSourceType === 0) {
      let currentUrl = resolvedUrl
      const maxPages = 50
      for (let page = 0; page < maxPages; page++) {
        const nextUrlRaw = engine.evaluate(nextContentRule, {
          baseUrl: currentUrl,
          content,
          src: content,
          result: content,
        })
        if (!nextUrlRaw)
          break

        const nextUrl = /^https?:\/\//i.test(nextUrlRaw)
          ? nextUrlRaw
          : new URL(nextUrlRaw, currentUrl).href
        if (!isSameChapterNextPage(currentUrl, nextUrl))
          break

        currentUrl = nextUrl
        content = await this.fetchSourceText(source, currentUrl)
        const pageHtml = engine.evaluate(rule, {
          baseUrl: currentUrl,
          content,
          src: content,
          result: content,
        })
        if (pageHtml)
          html = `${html}${pageHtml}`
      }
    }

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

    let text = html || content
    if (source.bookSourceType === 0 && text) {
      text = sanitizeNovelHtml(text)
      text = applyLegadoReplaceRegex(text, source.ruleContent?.replaceRegex)
    }

    return { text }
  }
}

interface BookState {
  name?: string
  author?: string
  kind?: string
  bookUrl?: string
  origin?: string
}

/** 已是目录 API 地址（如 mgsearcher），无需再抓详情页解析 tocUrl */
function isResolvedTocApiUrl(url: string): boolean {
  try {
    const { pathname, search } = new URL(url)
    if (pathname.includes('/api/'))
      return true
    if (/[?&]mid=\d+/i.test(search))
      return true
    return false
  }
  catch {
    return false
  }
}
