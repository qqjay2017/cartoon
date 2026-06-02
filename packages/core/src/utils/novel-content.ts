import * as cheerio from 'cheerio'

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

  return result.trim()
}
