import type { LocationQuery } from 'vue-router'

function queryValue(query: LocationQuery, key: string): string {
  const value = query[key]
  if (Array.isArray(value))
    return value[0] ?? ''
  return value == null ? '' : String(value)
}

/** mgsearcher 章节 URL 含 &，在 query 中可能被截断为独立参数 */
export function normalizeChapterUrl(query: LocationQuery): string {
  let url = queryValue(query, 'url')
  if (!url.includes('mgsearcher.com/api/chapter/getinfo'))
    return url

  const leakedC = queryValue(query, 'c')
  const leakedM = queryValue(query, 'm')
  const tocUrl = queryValue(query, 'tocUrl')
  const midFromToc = tocUrl.match(/[?&]mid=(\d+)/)?.[1] ?? leakedM

  if (!url.match(/[?&]c=\d+/) && leakedC)
    url = `${url.replace(/[?&]$/, '')}${url.includes('?') ? '&' : '?'}c=${leakedC}`

  if (midFromToc) {
    url = url.replace(/([?&])m=&/, `$1m=${midFromToc}&`)
    if (url.endsWith('?m=') || url.endsWith('&m='))
      url = `${url}${midFromToc}`
    if (!url.match(/[?&]m=\d+/))
      url = url.replace(/getinfo\?/, `getinfo?m=${midFromToc}&`).replace(/getinfo$/, `getinfo?m=${midFromToc}`)
  }

  return url
}

export function normalizeTocUrl(query: LocationQuery): string {
  let tocUrl = queryValue(query, 'tocUrl')
  if (!tocUrl.includes('mgsearcher.com/api/manga/get'))
    return tocUrl

  const leakedMode = queryValue(query, 'mode')
  if (!tocUrl.match(/[?&]mode=/) && leakedMode)
    tocUrl = `${tocUrl}${tocUrl.includes('?') ? '&' : '?'}mode=${leakedMode}`

  return tocUrl
}

export interface ReadRouteParams {
  sourceId: string
  chapterUrl: string
  bookUrl: string
  tocUrl: string
  sourceType: number
  title: string
}

export function parseReadRouteQuery(query: LocationQuery): ReadRouteParams {
  return {
    sourceId: queryValue(query, 'sourceId'),
    chapterUrl: normalizeChapterUrl(query),
    bookUrl: queryValue(query, 'bookUrl'),
    tocUrl: normalizeTocUrl(query),
    sourceType: Number(queryValue(query, 'sourceType') || 0),
    title: queryValue(query, 'title'),
  }
}

export function buildReadRouteQuery(params: {
  sourceId: string
  url: string
  bookUrl?: string
  tocUrl?: string
  sourceType?: number
  title?: string
}) {
  return {
    sourceId: params.sourceId,
    url: params.url,
    bookUrl: params.bookUrl ?? '',
    tocUrl: params.tocUrl ?? '',
    sourceType: String(params.sourceType ?? 0),
    title: params.title ?? '',
  }
}
