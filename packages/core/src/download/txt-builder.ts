import { sanitizeFilename } from '../utils/sanitize.js'

export interface TxtChapterInput {
  title: string
  text: string
}

export interface TxtBuildOptions {
  title: string
  author?: string
  intro?: string
  chapters: TxtChapterInput[]
}

export function buildTxt(options: TxtBuildOptions): Uint8Array {
  const lines: string[] = []

  lines.push(options.title)
  if (options.author)
    lines.push(`作者：${options.author}`)
  if (options.intro)
    lines.push('', stripHtml(options.intro))
  lines.push('', '='.repeat(40), '')

  for (const chapter of options.chapters) {
    lines.push(chapter.title)
    lines.push('-'.repeat(Math.min(chapter.title.length, 40)))
    lines.push('')
    lines.push(htmlToPlainText(chapter.text))
    lines.push('', '')
  }

  return new TextEncoder().encode(lines.join('\n'))
}

export function txtFilename(title: string): string {
  return sanitizeFilename(title, 'txt')
}

function htmlToPlainText(html: string): string {
  const trimmed = html.trim()
  if (!trimmed)
    return '（本章暂无内容）'

  return stripHtml(trimmed)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripHtml(html: string): string {
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
