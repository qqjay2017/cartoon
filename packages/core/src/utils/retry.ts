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
      if (!isRetryableNetworkError(error) || attempt >= retries)
        throw error
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }

  throw lastError
}
