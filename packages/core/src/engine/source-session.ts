import * as cheerio from 'cheerio'
import type { BookSource } from '../types/book-source.js'

export interface BookState {
  name?: string
  author?: string
  kind?: string
  intro?: string
  bookUrl?: string
  tocUrl?: string
  origin?: string
}

export interface RuleEvalContext {
  baseUrl: string
  content: string
  src?: string
  result?: string
  book?: BookState
  jsonItem?: unknown
}

export interface ElementHandle {
  attr: (name: string, value?: string) => string | undefined
  text: () => string
  html: () => string
}

export class SourceSession {
  private javaStore = new Map<string, string>()
  private variable = ''
  private jsLibFns = new Map<string, (...args: unknown[]) => unknown>()

  constructor(public readonly source: BookSource & { id: string }) {}

  getVariable(): string {
    return this.variable
  }

  setVariable(value: string): void {
    this.variable = value
  }

  createSourceProxy() {
    return {
      bookSourceUrl: this.source.bookSourceUrl,
      getVariable: () => this.getVariable(),
      setVariable: (value: string) => this.setVariable(value),
    }
  }

  initJsLib(runScript: (script: string, bindings: Record<string, unknown>) => Record<string, unknown>): void {
    if (!this.source.jsLib)
      return

    const exports = runScript(
      `${this.source.jsLib}; return { bhost: typeof bhost === 'function' ? bhost : undefined };`,
      {
        source: this.createSourceProxy(),
        baseUrl: this.source.bookSourceUrl,
      },
    )

    for (const [name, fn] of Object.entries(exports)) {
      if (typeof fn === 'function')
        this.jsLibFns.set(name, fn as (...args: unknown[]) => unknown)
    }
  }

  callJsLib(name: string, args: unknown[] = []): unknown {
    const fn = this.jsLibFns.get(name)
    if (!fn)
      return ''
    return fn.apply({ source: this.createSourceProxy() }, args)
  }

  javaGet(key: string): string {
    return this.javaStore.get(key) ?? ''
  }

  javaPut(key: string, value: string): void {
    this.javaStore.set(key, value)
  }

  createJavaApi(html: string) {
    const session = this
    return {
      get: (key: string) => session.javaGet(key),
      put: (key: string, value: string) => session.javaPut(key, value),
      log: (...args: unknown[]) => console.log(`[${session.source.bookSourceName}]`, ...args),
      toast: (...args: unknown[]) => console.log(`[toast:${session.source.bookSourceName}]`, ...args),
      longToast: (...args: unknown[]) => console.log(`[longToast:${session.source.bookSourceName}]`, ...args),
      t2s: (text: string) => text,
      getElements: (selector: string) => createElementCollection(html, selector),
    }
  }
}

function createElementCollection(html: string, selector: string) {
  const $ = cheerio.load(html)
  const elements = $(selector)

  const wrap = (node: any): ElementHandle => {
    const el = $(node)
    return {
      attr: (name: string, value?: string) => {
        if (value !== undefined) {
          el.attr(name, value)
          return value
        }
        return el.attr(name)
      },
      text: () => el.text(),
      html: () => el.html() ?? '',
    }
  }

  const collection = {
    length: elements.length,
    forEach: (fn: (item: ElementHandle, index: number) => void) => {
      elements.each((_index, node) => fn(wrap(node), _index))
    },
    map: (fn: (item: ElementHandle, index: number) => unknown) => {
      const out: unknown[] = []
      elements.each((index, node) => {
        out.push(fn(wrap(node), index))
      })
      return out
    },
    toString: () => elements.toArray().map(node => $.html(node)).join('\n'),
    [Symbol.toPrimitive]: () => elements.toArray().map(node => $.html(node)).join('\n'),
  }

  return collection
}

export function elementsToHtml(collection: ReturnType<SourceSession['createJavaApi']>['getElements'] extends (...args: infer _A) => infer R ? R : never): string {
  return String(collection)
}
