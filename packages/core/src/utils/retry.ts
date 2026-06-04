function collectErrorSignals(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  let depth = 0

  while (current instanceof Error && depth < 6) {
    parts.push(current.name, current.message)
    const code = (current as NodeJS.ErrnoException).code
    if (code)
      parts.push(code)
    current = current.cause
    depth++
  }

  return parts.join(' ').toLowerCase()
}

export function isRetryableNetworkError(error: unknown): boolean {
  const text = collectErrorSignals(error)
  return text.includes('aborterror')
    || text.includes('aborted')
    || text.includes('timeout')
    || text.includes('timed out')
    || text.includes('econnreset')
    || text.includes('econnrefused')
    || text.includes('etimedout')
    || text.includes('enotfound')
    || text.includes('socket')
    || text.includes('tls')
    || text.includes('network')
    || text.includes('fetch failed')
    || text.includes('disconnected before secure tls')
}

export function isRetryableHttpError(error: unknown): boolean {
  const text = collectErrorSignals(error)
  return text.includes('429')
    || text.includes('too many requests')
    || text.includes('http 502')
    || text.includes('http 503')
    || text.includes('http 504')
}

export function isRetryableError(error: unknown): boolean {
  return isRetryableNetworkError(error) || isRetryableHttpError(error)
}

function retryDelayMs(baseDelayMs: number, attempt: number, error: unknown): number {
  const text = collectErrorSignals(error)
  if (text.includes('429') || text.includes('too many requests'))
    return baseDelayMs * (2 ** attempt) * 2
  return baseDelayMs * (attempt + 1)
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number, delayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 3
  const delayMs = options?.delayMs ?? 1500
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt >= retries)
        throw error
      await new Promise(resolve => setTimeout(resolve, retryDelayMs(delayMs, attempt, error)))
    }
  }

  throw lastError
}
