import vm from 'node:vm'
import { JSONPath } from 'jsonpath-plus'
import type { BookState, RuleEvalContext, SourceSession } from './source-session.js'

export interface JsRuntimeOptions {
  timeout?: number
}

export class JsRuntime {
  constructor(private options: JsRuntimeOptions = {}) {}

  runScript(script: string, bindings: Record<string, unknown>): Record<string, unknown> {
    const sandbox = vm.createContext({
      ...bindings,
      console,
      JSON,
      Array,
      String,
      Number,
      Boolean,
      Object,
      Math,
      Date,
      RegExp,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
    })

    const wrapped = `(function(){ ${script} })()`
    const result = vm.runInContext(wrapped, sandbox, {
      timeout: this.options.timeout ?? 5000,
    })

    if (typeof result === 'object' && result !== null)
      return result as Record<string, unknown>

    return {}
  }

  evaluateRule(
    rule: string,
    ctx: RuleEvalContext,
    session: SourceSession,
    evaluateNestedRule: (nestedRule: string, content: string, baseUrl: string) => string,
  ): string {
    const expanded = this.expandTemplates(rule, ctx, session, evaluateNestedRule)
    const script = this.extractScript(expanded)
    if (!script)
      return ''

    const html = ctx.src ?? ctx.content
    const result = this.runExpression(script, {
      result: ctx.result ?? '',
      src: ctx.src ?? ctx.content,
      baseUrl: ctx.baseUrl,
      book: ctx.book ?? {},
      java: session.createJavaApi(html),
      source: session.createSourceProxy(),
      content: ctx.content,
      jsonItem: ctx.jsonItem,
    })

    return result == null ? '' : String(result)
  }

  evaluateHeader(rule: string, baseUrl: string, session: SourceSession): Record<string, string> {
    const script = this.extractScript(rule.trim())
    if (!script)
      return {}

    const raw = this.runExpression(script, {
      baseUrl,
      java: session.createJavaApi(''),
      source: session.createSourceProxy(),
    })

    try {
      return JSON.parse(String(raw)) as Record<string, string>
    }
    catch {
      return {}
    }
  }

  resolveTemplate(
    template: string,
    vars: { key?: string, page?: number, baseUrl?: string },
    session: SourceSession,
  ): string {
    let url = template

    url = url.replace(/\{\{(\w+)\(([^)]*)\)\}\}/g, (_match, fnName, argsRaw) => {
      const args = argsRaw.trim() ? argsRaw.split(',').map((s: string) => s.trim()) : []
      const value = session.callJsLib(fnName, args)
      return value == null ? '' : String(value)
    })

    if (vars.key !== undefined)
      url = url.replace(/\{\{key\}\}/g, encodeURIComponent(vars.key))
    if (vars.page !== undefined)
      url = url.replace(/\{\{page\}\}/g, String(vars.page))

    if (!/^https?:\/\//i.test(url) && vars.baseUrl)
      url = new URL(url, vars.baseUrl).href

    return url
  }

  private expandTemplates(
    rule: string,
    ctx: RuleEvalContext,
    _session: SourceSession,
    evaluateNestedRule: (nestedRule: string, content: string, baseUrl: string) => string,
  ): string {
    return rule.replace(/\{\{(@@?)?([^}]+)\}\}/g, (_match, prefix, nestedRule) => {
      const trimmed = String(nestedRule).trim()
      if (trimmed.startsWith('$') && ctx.jsonItem !== undefined) {
        const result = JSONPath({ path: trimmed, json: ctx.jsonItem as never })
        if (Array.isArray(result))
          return result.length ? String(result[0] ?? '') : ''
        return result == null ? '' : String(result)
      }

      const content = prefix === '@' || prefix === '@@'
        ? (ctx.src ?? ctx.content)
        : ctx.content
      return evaluateNestedRule(trimmed, content, ctx.baseUrl)
    })
  }

  private extractScript(rule: string): string | null {
    const trimmed = rule.trim()
    if (trimmed.startsWith('@js:'))
      return trimmed.slice(4).trim()

    const jsMatch = trimmed.match(/^<js>([\s\S]*)<\/js>/i)
    if (jsMatch)
      return jsMatch[1]!.trim()

    return null
  }

  evaluateExpression(script: string, bindings: Record<string, unknown>): unknown {
    return this.runExpression(script, bindings)
  }

  private runExpression(script: string, bindings: Record<string, unknown>): unknown {
    const keys = Object.keys(bindings)
    const values = Object.values(bindings)
    const assignments = keys.map((key, index) => `var ${key} = __args[${index}];`).join('\n')
    const runner = new Function('__args', '__script', `
${assignments}
return eval(__script);
`)
    return runner(values, script)
  }
}

export function isJsRule(rule?: string): boolean {
  if (!rule)
    return false
  const trimmed = rule.trim()
  return trimmed.startsWith('@js:') || trimmed.startsWith('<js>')
}

export function splitJsTransform(rule: string): { baseRule: string, jsCode?: string, regexParts: string[] } {
  const jsInline = rule.match(/^([\s\S]*?)<js>([\s\S]*?)<\/js>([\s\S]*)$/i)
  if (jsInline) {
    const tail = jsInline[3] ?? ''
    const regexParts = tail.startsWith('##') ? tail.slice(2).split('##') : []
    return {
      baseRule: jsInline[1]!.trim(),
      jsCode: jsInline[2]!.trim(),
      regexParts,
    }
  }

  const hashIndex = rule.indexOf('##')
  if (hashIndex === -1)
    return { baseRule: rule, regexParts: [] }

  return {
    baseRule: rule.slice(0, hashIndex),
    regexParts: rule.slice(hashIndex + 2).split('##'),
  }
}

export type { BookState }
