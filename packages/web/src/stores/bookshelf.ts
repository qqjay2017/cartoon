import type { BookshelfItem } from '@cartoon/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { createBookRef, isLegacyBookId, refFromLegacyId } from '../utils/book-ref'

const STORAGE_KEY = 'cartoon-bookshelf'

function migrateItem(item: BookshelfItem): BookshelfItem {
  if (!isLegacyBookId(item.id))
    return item
  const ref = refFromLegacyId(item.id)
  if (!ref)
    return item
  return { ...item, id: ref }
}

function loadItems(): BookshelfItem[] {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BookshelfItem[]).map(migrateItem)
  }
  catch {
    return []
  }
}

export const useBookshelfStore = defineStore('bookshelf', () => {
  const items = ref<BookshelfItem[]>(loadItems())

  watch(items, (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }, { deep: true })

  const count = computed(() => items.value.length)

  function makeId(sourceId: string, bookUrl: string) {
    return createBookRef(sourceId, bookUrl)
  }

  function has(sourceId: string, bookUrl: string) {
    const id = makeId(sourceId, bookUrl)
    return items.value.some(item => item.id === id)
  }

  function add(item: Omit<BookshelfItem, 'id' | 'addedAt'>) {
    const id = makeId(item.sourceId, item.bookUrl)
    if (items.value.some(existing => existing.id === id))
      return

    items.value.unshift({
      ...item,
      id,
      addedAt: Date.now(),
    })
  }

  function remove(id: string) {
    items.value = items.value.filter(item => item.id !== id)
  }

  function updateProgress(id: string, chapterUrl: string, chapterName: string) {
    const target = items.value.find(item => item.id === id)
    if (target) {
      target.lastReadChapterUrl = chapterUrl
      target.lastReadChapterName = chapterName
    }
  }

  return { items, count, has, add, remove, updateProgress, makeId }
})
