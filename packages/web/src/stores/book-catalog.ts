import type { BookSourceType, SearchBook } from '@cartoon/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { createBookRef } from '../utils/book-ref'

export interface CatalogBook {
  ref: string
  sourceId: string
  sourceName: string
  sourceType: BookSourceType
  bookUrl: string
  name: string
  author?: string
  coverUrl?: string
  tocUrl?: string
}

export interface ReadingProgress {
  chapterIndex: number
  chapterUrl: string
  chapterName: string
}

const BOOKS_KEY = 'cartoon-book-catalog'
const READING_KEY = 'cartoon-reading-progress'

function loadBooks(): Record<string, CatalogBook> {
  try {
    return JSON.parse(localStorage.getItem(BOOKS_KEY) ?? '{}') as Record<string, CatalogBook>
  }
  catch {
    return {}
  }
}

function loadReading(): Record<string, ReadingProgress> {
  try {
    return JSON.parse(localStorage.getItem(READING_KEY) ?? '{}') as Record<string, ReadingProgress>
  }
  catch {
    return {}
  }
}

export type RegisterBookInput = Pick<CatalogBook, 'sourceId' | 'sourceName' | 'sourceType' | 'bookUrl' | 'name'>
  & Partial<Pick<CatalogBook, 'author' | 'coverUrl' | 'tocUrl'>>

export const useBookCatalogStore = defineStore('book-catalog', () => {
  const books = ref<Record<string, CatalogBook>>(loadBooks())
  const reading = ref<Record<string, ReadingProgress>>(loadReading())

  watch(books, value => localStorage.setItem(BOOKS_KEY, JSON.stringify(value)), { deep: true })
  watch(reading, value => localStorage.setItem(READING_KEY, JSON.stringify(value)), { deep: true })

  function register(input: RegisterBookInput): string {
    const ref = createBookRef(input.sourceId, input.bookUrl)
    const existing = books.value[ref]
    books.value[ref] = {
      ref,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceType: input.sourceType,
      bookUrl: input.bookUrl,
      name: input.name,
      author: input.author ?? existing?.author,
      coverUrl: input.coverUrl ?? existing?.coverUrl,
      tocUrl: input.tocUrl ?? existing?.tocUrl,
    }
    return ref
  }

  function registerFromSearch(book: SearchBook): string {
    return register({
      sourceId: book.sourceId,
      sourceName: book.sourceName,
      sourceType: book.sourceType,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
    })
  }

  function get(ref: string): CatalogBook | undefined {
    return books.value[ref]
  }

  function update(ref: string, patch: Partial<CatalogBook>): void {
    const existing = books.value[ref]
    if (!existing)
      return
    books.value[ref] = { ...existing, ...patch, ref }
  }

  function setReading(ref: string, progress: ReadingProgress): void {
    reading.value[ref] = progress
  }

  function getReading(ref: string): ReadingProgress | undefined {
    return reading.value[ref]
  }

  return {
    books,
    reading,
    register,
    registerFromSearch,
    get,
    update,
    setReading,
    getReading,
  }
})
