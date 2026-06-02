import * as cheerio from 'cheerio'
import { isJsonContent, isJsonPathRule, parseJsonContent, queryJsonField, queryJsonPath } from './json-rules.js'
import { isJsRule, JsRuntime, splitJsTransform } from './js-runtime.js'
import type { RuleEvalContext, SourceSession } from './source-session.js'

type CheerioSelection = cheerio.Cheerio<any>

export interface RuleContext {
  baseUrl: string
}

export interface RuleEngineOptions {
  jsRuntime?: JsRuntime
  session?: SourceSession
}

export class RuleEngine {
  private jsRuntime: JsRuntime

  constructor(private options: RuleEngineOptions = {}) {
    this.jsRuntime = options.jsRuntime ?? new JsRuntime()
  }

  evaluate(rule: string | undefined, ctx: RuleEvalContext): string {
    if (!rule)
      return ''

    if (isJsRule(rule)) {
      const { regexParts } = splitJsTransform(rule)
      const value = this.jsRuntime.evaluateRule(
        rule,
        ctx,
        this.requireSession(),
        (nested, content, baseUrl) => this.evaluate(nested, { ...ctx, content, baseUrl }),
      )
      return this.applyRegexParts(value, regexParts)
    }

    const { baseRule, jsCode, regexParts } = splitJsTransform(rule)
    let value = this.evaluateBase(baseRule, ctx)
    if (jsCode) {
      value = this.jsRuntime.evaluateRule(
        `<js>${jsCode}</js>`,
        { ...ctx, result: value },
        this.requireSession(),
        (nested, content, baseUrl) => this.evaluate(nested, { ...ctx, content, baseUrl }),
      )
    }
    return this.applyRegexParts(value, regexParts)
  }

  parse(html: string, rule: string | undefined, ctx: RuleContext): string {
    return this.evaluate(rule, { baseUrl: ctx.baseUrl, content: html, src: html })
  }

  parseList(html: string, listRule: string | undefined, _ctx: RuleContext): CheerioSelection {
    const $ = cheerio.load(html)
    if (!listRule)
      return $('')

    if (isJsonContent(html) && isJsonPathRule(listRule)) {
      return $('')
    }

    const selector = this.toListSelector(listRule)
    return $(selector)
  }

  parseJsonList(content: string, listRule?: string): unknown[] {
    if (!listRule)
      return []

    const data = parseJsonContent(content)
    return queryJsonPath(data, listRule)
  }

  parseElement($el: CheerioSelection, rule: string | undefined, ctx: RuleContext): string {
    if (!rule)
      return ''

    if (isJsRule(rule)) {
      return this.jsRuntime.evaluateRule(
        rule,
        {
          baseUrl: ctx.baseUrl,
          content: cheerio.load('<div></div>')('div').html() ?? '',
          src: cheerio.load('<div></div>')('div').html() ?? '',
          jsonItem: $el.length ? $el.get(0) : undefined,
        },
        this.requireSession(),
        (nested, content, baseUrl) => this.evaluate(nested, { baseUrl, content, src: content }),
      )
    }

    const parts = rule.split('@')
    let current: CheerioSelection = $el

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const result = this.parseResultPart(part)
      if (result)
        return this.extractResult(current, result.kind, result.regexParts, ctx)

      const selector = this.toCssSelector(part)
      if (selector)
        current = current.find(selector)
    }

    return current.first().text().trim()
  }

  parseJsonItem(item: unknown, rule: string | undefined, ctx: RuleEvalContext): string {
    if (!rule)
      return ''

    if (isJsRule(rule)) {
      return this.jsRuntime.evaluateRule(
        rule,
        { ...ctx, jsonItem: item, content: JSON.stringify(item) },
        this.requireSession(),
        (nested, content, baseUrl) => this.evaluate(nested, { ...ctx, content, baseUrl }),
      )
    }

    if (isJsonPathRule(rule))
      return queryJsonField(item, rule.startsWith('$') ? rule.replace(/^\$\.?/, '.') : rule)

    return queryJsonField(item, `.${rule}`)
  }

  private evaluateBase(rule: string, ctx: RuleEvalContext): string {
    const trimmed = rule.trim()
    if (!trimmed)
      return ''

    if (isJsonContent(ctx.content) && isJsonPathRule(trimmed))
      return queryJsonField(parseJsonContent(ctx.content), trimmed)

    return this.applyRegexChain(trimmed, ctx.content, ctx.baseUrl, 'string') as string
  }

  private applyRegexChain(
    rule: string,
    html: string,
    baseUrl: string,
    mode: 'string' | 'list',
  ): string | string[] {
    const ctx: RuleContext = { baseUrl }
    const segments = rule.split('&&').map(s => s.trim()).filter(Boolean)
    const values = segments.map((segment) => {
      const fallbacks = segment.split('||').map(s => s.trim())
      for (const fb of fallbacks) {
        const val = mode === 'list'
          ? this.parseElements(html, fb, ctx).join('')
          : this.parseSingle(html, fb, ctx)
        if (val)
          return val
      }
      return ''
    })

    return mode === 'list' ? values : values.join('')
  }

  private parseElements(html: string, rule: string, ctx: RuleContext): string[] {
    const listRule = rule.split('&&')[0]?.split('||')[0]
    if (!listRule)
      return []

    const $ = cheerio.load(html)
    const elements = $(this.toListSelector(listRule.split('@')[0] ?? listRule))
    const results: string[] = []

    elements.each((_, el) => {
      const value = this.parseElement($(el), rule, ctx)
      if (value)
        results.push(value)
    })

    return results
  }

  private parseSingle(html: string, rule: string, ctx: RuleContext): string {
    const $ = cheerio.load(html)
    const parts = rule.split('@')
    let current: CheerioSelection = $.root()

    if (parts[0] && !this.parseResultPart(parts[0])) {
      const rootSelector = this.toCssSelector(parts[0]!)
      current = rootSelector ? $(rootSelector) : $.root()
    }

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!
      const result = this.parseResultPart(part)
      if (result)
        return this.extractResult(current, result.kind, result.regexParts, ctx)

      const selector = this.toCssSelector(part)
      if (selector)
        current = current.find(selector)
    }

    if (parts.length === 1 && parts[0]) {
      const result = this.parseResultPart(parts[0])
      if (result)
        return this.extractResult(current, result.kind, result.regexParts, ctx)
    }

    return current.first().text().trim()
  }

  private parseResultPart(part: string): { kind: string, regexParts: string[] } | null {
    const known = ['text', 'textNodes', 'html', 'href', 'src', 'content', 'style']
    const hashIndex = part.indexOf('##')
    const head = hashIndex === -1 ? part : part.slice(0, hashIndex)
    const regexParts = hashIndex === -1 ? [] : part.slice(hashIndex + 2).split('##')

    if (known.includes(head) || head.startsWith('data-') || head === 'content')
      return { kind: head, regexParts }

    return null
  }

  private extractResult(
    $el: CheerioSelection,
    kind: string,
    regexParts: string[],
    ctx: RuleContext,
  ): string {
    let value = ''

    switch (kind) {
      case 'text':
        value = $el.first().text().trim()
        break
      case 'textNodes':
        value = $el.first().contents().filter((_, n) => n.type === 'text').text().trim()
        break
      case 'html':
        value = $el.first().html() ?? ''
        break
      case 'href':
        value = this.resolveUrl($el.first().attr('href') ?? '', ctx.baseUrl)
        break
      case 'src':
        value = this.resolveUrl($el.first().attr('src') ?? '', ctx.baseUrl)
        break
      case 'content':
        value = $el.first().attr('content') ?? ''
        break
      default:
        value = $el.first().attr(kind) ?? $el.first().text().trim()
        if (['src', 'href', 'data-original'].includes(kind) || kind.startsWith('data-'))
          value = this.resolveUrl(value, ctx.baseUrl)
    }

    return this.applyRegexParts(value, regexParts)
  }

  private toListSelector(listRule: string): string {
    const parts = listRule.split('@').map(part => this.toCssSelector(part)).filter(Boolean)
    if (parts.length <= 1)
      return parts[0] ?? listRule

    return parts.join(' ')
  }

  private toCssSelector(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed)
      return ''

    const head = trimmed.split('##')[0]!

    if (head.startsWith('.') || head.startsWith('#') || head.startsWith('['))
      return head

    if (head.includes('[') || head.includes('>') || head.includes(':') || head.includes(' '))
      return head

    if (trimmed.startsWith('tag.'))
      return trimmed.slice(4).trim().split('##')[0]!

    if (trimmed.startsWith('id.'))
      return `#${trimmed.slice(3).trim().replace(/\s+/g, '.').split('##')[0]!}`

    if (trimmed.startsWith('class.')) {
      const classes = trimmed.slice(6).trim().split(/\s+/).filter(Boolean)
      return classes.map(name => `.${name.split('##')[0]!}`).join('')
    }

    if (/^[a-zA-Z][\w-]*$/.test(head))
      return head

    return head.split(/\s+/).filter(Boolean).map(name => `.${name}`).join('')
  }

  private applyRegexParts(value: string, regexParts: string[]): string {
    let result = value
    for (let i = 0; i < regexParts.length; i += 2) {
      const pattern = regexParts[i]
      const replacement = regexParts[i + 1] ?? ''
      if (!pattern)
        continue
      try {
        result = result.replace(new RegExp(pattern), replacement)
      }
      catch {
        // ignore invalid regex
      }
    }
    return result.trim()
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (!url)
      return ''
    if (/^https?:\/\//i.test(url))
      return url
    try {
      return new URL(url, baseUrl).href
    }
    catch {
      return url
    }
  }

  private requireSession(): SourceSession {
    if (!this.options.session)
      throw new Error('JS rule requires SourceSession')
    return this.options.session
  }
}
