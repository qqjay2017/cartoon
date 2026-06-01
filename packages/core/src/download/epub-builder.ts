import JSZip from 'jszip'
import { escapeXml, sanitizeFilename } from '../utils/sanitize.js'

export interface EpubChapterInput {
  title: string
  html: string
}

export interface EpubBuildOptions {
  title: string
  author?: string
  intro?: string
  cover?: Uint8Array
  coverExt?: string
  chapters: EpubChapterInput[]
}

const STYLE = `body{font-family:"PingFang SC","Microsoft YaHei",serif;line-height:1.8;padding:1em;}
h1{font-size:1.4em;text-align:center;margin-bottom:1.5em;}
p{text-indent:2em;margin:0.6em 0;}`

export async function buildEpub(options: EpubBuildOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  const author = options.author || 'Unknown'
  const uuid = `urn:uuid:${crypto.randomUUID()}`
  const chapterFiles: string[] = []

  options.chapters.forEach((chapter, index) => {
    const id = `chapter-${String(index + 1).padStart(3, '0')}`
    chapterFiles.push(id)
    const body = normalizeChapterHtml(chapter.html)
    zip.file(`OEBPS/${id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>${escapeXml(chapter.title)}</h1>${body}</body>
</html>`)
  })

  zip.file('OEBPS/style.css', STYLE)

  let coverItem = ''
  let coverMetaTag = ''
  if (options.cover) {
    const ext = options.coverExt || 'jpg'
    const coverName = `cover.${ext}`
    zip.file(`OEBPS/${coverName}`, options.cover)
    coverItem = `<item id="cover-image" href="${coverName}" media-type="${mediaTypeForExt(ext)}" properties="cover-image"/>`
    coverMetaTag = `<meta name="cover" content="cover-image"/>`
  }

  const manifestItems = chapterFiles.map(id =>
    `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`,
  ).join('\n    ')

  const spineItems = chapterFiles.map(id =>
    `<itemref idref="${id}"/>`,
  ).join('\n    ')

  const navPoints = options.chapters.map((chapter, index) => {
    const id = chapterFiles[index]!
    return `<navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${id}.xhtml"/>
    </navPoint>`
  }).join('\n    ')

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(options.title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="BookId">${uuid}</dc:identifier>
    ${options.intro ? `<dc:description>${escapeXml(stripHtml(options.intro))}</dc:description>` : ''}
    ${coverMetaTag}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${coverItem}
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`)

  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uuid}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(options.title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`)

  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  const buffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })

  return buffer
}

export function epubFilename(title: string): string {
  return sanitizeFilename(title, 'epub')
}

function normalizeChapterHtml(html: string): string {
  const trimmed = html.trim()
  if (!trimmed)
    return '<p>（本章暂无内容）</p>'
  if (trimmed.startsWith('<'))
    return trimmed
  return trimmed.split(/\n+/).map(p => `<p>${escapeXml(p.trim())}</p>`).join('')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function mediaTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}
