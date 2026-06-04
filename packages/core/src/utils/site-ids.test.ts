import { describe, expect, it } from 'vitest'
import { bookIdFromUrl, bookshelfId, chapterIdFromUrl, parseBookshelfId } from './site-ids.js'

describe('site-ids', () => {
  it('parses genwohua book and chapter ids', () => {
    expect(bookIdFromUrl('https://www.genwohua.com/xs/4854/')).toBe('4854')
    expect(chapterIdFromUrl('https://www.genwohua.com/xs/4854/1972793.html')).toBe('1972793')
    expect(bookshelfId('genwohua', '4854')).toBe('genwohua:4854')
    expect(parseBookshelfId('genwohua:4854')).toEqual({ sourceId: 'genwohua', bookId: '4854' })
  })

  it('uses bookUrlPattern capture when provided', () => {
    const pattern = String.raw`https://www\.genwohua\.com/xs/(\d+)/`
    expect(bookIdFromUrl('https://www.genwohua.com/xs/4854/', pattern)).toBe('4854')
  })
})
