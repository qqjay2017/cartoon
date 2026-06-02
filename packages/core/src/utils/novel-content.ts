import * as cheerio from 'cheerio'

/** 章节正文分页 id，如 595707.html / 595707_2.html → 595707 */
export function getChapterPageId(url: string): string | null {
  const match = url.match(/\/(\d+)(?:_\d+)?\.html(?:[?#]|$)/i)
  return match?.[1] ?? null
}

/** next 链接是否为同一章的下一页（595707_2.html），而非下一章（597100.html） */
export function isSameChapterNextPage(currentUrl: string, nextUrl: string): boolean {
  const currentId = getChapterPageId(currentUrl)
  const nextId = getChapterPageId(nextUrl)
  if (!currentId || !nextId || currentId !== nextId)
    return false
  return /_\d+\.html/i.test(nextUrl)
}

/** 将含 `<br>` / 块级标签的小说 HTML 转为纯文本，`<br>` 转为换行 */
export function novelHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function applyLegadoReplaceRegex(value: string, replaceRegex?: string): string {
  if (!replaceRegex?.startsWith('##'))
    return value

  const parts = replaceRegex.slice(2).split('##')
  let result = value
  for (let i = 0; i < parts.length; i += 2) {
    const pattern = parts[i]
    if (!pattern)
      continue
    const replacement = parts[i + 1] ?? ''
    try {
      result = result.replace(new RegExp(pattern, 'g'), replacement)
    }
    catch {
      // ignore invalid regex
    }
  }
  return result.trim()
}

export function sanitizeNovelHtml(html: string): string {
  const trimmed = html.trim()
  if (!trimmed)
    return trimmed

  const $ = cheerio.load(`<div data-novel-root="1">${trimmed}</div>`)
  const root = $('[data-novel-root="1"]')

  root.find('script, iframe, style, noscript').remove()
  root.find('h1, .txtinfo, .contentadv, .bottom-ad, #txtright, .hide720').remove()
  root.find('[id^="ad-"], [id^="pf-"], [id^="bg-ssp"], [class*="bg-ssp"], [class*="bg-container"]').remove()

  root.find('div').each((_, element) => {
    const $element = $(element)
    if (!$element.text().trim() && !$element.find('br').length)
      $element.remove()
  })

  let result = root.html() ?? ''

  result = result.replace(
    /^\s*(?:<br\s*\/?>\s*)*第[\d一二三四五六七八九十百千万零两]+章[^<]*?(?=<br)/i,
    '',
  )
  result = result.replace(/(\s|<br\s*\/?>)*\(本章完\)(\s|<br\s*\/?>)*/gi, '')
  result = result.replace(/^(?:\s|<br\s*\/?>)+/i, '')
  result = result.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')

  if (/<br\s*\/?>/i.test(result))
    result = brHtmlToParagraphHtml(result)

  return result.trim()
}

function brHtmlToParagraphHtml(html: string): string {
  const paragraphs = novelHtmlToPlainText(html)
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  if (!paragraphs.length)
    return html

  return paragraphs.map(p => `<p>${p}</p>`).join('')
}
