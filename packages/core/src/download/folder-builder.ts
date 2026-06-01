import JSZip from 'jszip'
import { sanitizeFilename } from '../utils/sanitize.js'
import type { CbzPageInput } from './cbz-builder.js'

export interface ComicFolderChapterInput {
  name: string
  pages: CbzPageInput[]
}

export async function buildComicFolder(
  title: string,
  chapters: ComicFolderChapterInput[],
): Promise<Uint8Array> {
  const zip = new JSZip()
  const rootName = sanitizeFolderName(title)

  chapters.forEach((chapter, chapterIndex) => {
    const folderName = `${String(chapterIndex + 1).padStart(3, '0')}_${sanitizeFolderName(chapter.name)}`
    const usedNames = new Set<string>()

    chapter.pages.forEach((page, pageIndex) => {
      const ext = page.ext.replace(/^\./, '') || 'jpg'
      let fileName = `${String(pageIndex + 1).padStart(3, '0')}.${ext}`
      while (usedNames.has(fileName)) {
        fileName = `${String(pageIndex + 1).padStart(3, '0')}_${usedNames.size}.${ext}`
      }
      usedNames.add(fileName)
      zip.file(`${rootName}/${folderName}/${fileName}`, page.data)
    })
  })

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
  })
}

export function folderFilename(title: string): string {
  return sanitizeFilename(`${title}_图片`, 'zip')
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'chapter'
}
