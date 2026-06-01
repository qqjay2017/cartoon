export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()
    return name === 'aborterror'
      || msg.includes('aborted')
      || msg.includes('timeout')
      || msg.includes('timed out')
      || msg.includes('econnreset')
      || msg.includes('etimedout')
      || msg.includes('socket')
      || msg.includes('network')
      || msg.includes('fetch failed')
  }
  return false
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
