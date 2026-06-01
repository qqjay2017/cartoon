import type { BookshelfItem } from '@cartoon/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'cartoon-bookshelf'

function loadItems(): BookshelfItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BookshelfItem[]
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
    return `${sourceId}::${bookUrl}`
  }

  function has(sourceId: string, bookUrl: string) {
    return items.value.some(item => item.id === makeId(sourceId, bookUrl))
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

  return { items, count, has, add, remove, updateProgress }
})
