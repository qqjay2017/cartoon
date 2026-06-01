import JSZip from 'jszip'
import { sanitizeFilename } from '../utils/sanitize.js'

export interface CbzPageInput {
  data: Uint8Array
  ext: string
}

export async function buildCbz(pages: CbzPageInput[]): Promise<Uint8Array> {
  const zip = new JSZip()
  const usedNames = new Set<string>()

  pages.forEach((page, index) => {
    const ext = page.ext.replace(/^\./, '') || 'jpg'
    let name = `${String(index + 1).padStart(3, '0')}.${ext}`
    while (usedNames.has(name)) {
      name = `${String(index + 1).padStart(3, '0')}_${usedNames.size}.${ext}`
    }
    usedNames.add(name)
    zip.file(name, page.data)
  })

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

export function cbzFilename(title: string): string {
  return sanitizeFilename(title, 'cbz')
}

export function imageExtFromUrl(url: string, contentType?: string): string {
  const fromUrl = url.split('?')[0]?.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]
  if (fromUrl)
    return fromUrl.toLowerCase().replace('jpeg', 'jpg')

  if (contentType?.includes('png'))
    return 'png'
  if (contentType?.includes('webp'))
    return 'webp'
  if (contentType?.includes('gif'))
    return 'gif'
  return 'jpg'
}
