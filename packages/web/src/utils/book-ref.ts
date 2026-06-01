/** 同一书源 + 同一 bookUrl 对应唯一 ref；不同书源同名书各自独立 */
export function createBookRef(sourceId: string, bookUrl: string): string {
  const input = `${sourceId}\0${bookUrl}`
  let hash = 5381
  for (let i = 0; i < input.length; i++)
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function isLegacyBookId(id: string): boolean {
  return id.includes('::')
}

export function refFromLegacyId(legacyId: string): string | null {
  const split = legacyId.indexOf('::')
  if (split <= 0)
    return null
  return createBookRef(legacyId.slice(0, split), legacyId.slice(split + 2))
}
