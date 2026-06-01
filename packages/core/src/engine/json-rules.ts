import { JSONPath } from 'jsonpath-plus'

export function isJsonContent(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

export function parseJsonContent(content: string): unknown {
  return JSON.parse(content.trim())
}

export function isJsonPathRule(rule?: string): boolean {
  if (!rule)
    return false
  const trimmed = rule.trim()
  return trimmed.startsWith('.') || trimmed.startsWith('$')
}

export function queryJsonPath(data: unknown, path: string): unknown[] {
  const normalized = normalizeJsonPath(path)
  let result = JSONPath({ path: normalized, json: data as never, wrap: true })
  if ((!result || result.length === 0) && isApiWrapper(data))
    result = JSONPath({ path: normalized, json: (data as { data: unknown }).data as never, wrap: true })

  return Array.isArray(result) ? result : [result]
}

export function queryJsonField(item: unknown, path: string): string {
  const normalized = normalizeJsonPath(path)
  let result = JSONPath({ path: normalized, json: item as never })

  if ((result == null || (Array.isArray(result) && result.length === 0)) && path.startsWith('.')) {
    const recursive = `$..${path.slice(1)}`
    result = JSONPath({ path: recursive, json: item as never })
  }

  if (Array.isArray(result))
    return result.length ? String(result[0] ?? '') : ''
  return result == null ? '' : String(result)
}

function normalizeJsonPath(path: string): string {
  return path.startsWith('$') ? path : `$${path.startsWith('.') ? path : `.${path}`}`
}

function isApiWrapper(data: unknown): data is { data: unknown } {
  return typeof data === 'object' && data !== null && 'data' in data
}

export function normalizeChapterListRule(rule: string): string {
  return rule.replace(/\[\*\]/g, '[*]')
}
