<script setup lang="ts">
import type { SearchBook } from '../api/client'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, proxyImage } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'

const router = useRouter()
const bookshelf = useBookshelfStore()

const keyword = ref('')
const type = ref<'all' | '0' | '2'>('all')
const loading = ref(false)
const error = ref('')
const results = ref<SearchBook[]>([])

async function search() {
  if (!keyword.value.trim())
    return

  loading.value = true
  error.value = ''
  try {
    const parsedType = type.value === 'all' ? undefined : Number(type.value) as 0 | 2
    const data = await api.search(keyword.value.trim(), parsedType)
    results.value = data.results
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '搜索失败'
  }
  finally {
    loading.value = false
  }
}

function openBook(book: SearchBook) {
  router.push({
    name: 'book',
    query: {
      sourceId: book.sourceId,
      url: book.bookUrl,
    },
  })
}

function addToShelf(book: SearchBook) {
  bookshelf.add({
    sourceId: book.sourceId,
    sourceName: book.sourceName,
    sourceType: book.sourceType,
    name: book.name,
    author: book.author,
    coverUrl: book.coverUrl,
    bookUrl: book.bookUrl,
  })
}

function typeLabel(sourceType: number) {
  return sourceType === 2 ? '漫画' : '小说'
}
</script>

<template>
  <section class="panel">
    <div class="search-bar">
      <input
        v-model="keyword"
        placeholder="搜索小说或漫画，聚合所有书源..."
        @keyup.enter="search"
      >
      <select v-model="type">
        <option value="all">全部</option>
        <option value="0">小说</option>
        <option value="2">漫画</option>
      </select>
      <button :disabled="loading" @click="search">
        {{ loading ? '搜索中...' : '搜索' }}
      </button>
    </div>

    <p v-if="error" class="meta">{{ error }}</p>
    <p v-else-if="results.length" class="meta">共 {{ results.length }} 条结果</p>

    <div v-if="results.length" class="grid">
      <article v-for="book in results" :key="`${book.sourceId}-${book.bookUrl}`" class="card">
        <div class="card-cover" @click="openBook(book)">
          <img v-if="book.coverUrl" :src="proxyImage(book.coverUrl)" :alt="book.name">
          <span v-else>{{ book.name.slice(0, 1) }}</span>
        </div>
        <div class="card-body">
          <div class="card-title">{{ book.name }}</div>
          <div class="meta">
            <span class="badge">{{ typeLabel(book.sourceType) }}</span>
            {{ book.sourceName }}
          </div>
          <div v-if="book.author" class="meta">作者：{{ book.author }}</div>
          <div v-if="book.lastChapter" class="meta">最新：{{ book.lastChapter }}</div>
          <div class="actions">
            <button class="primary" @click="openBook(book)">详情</button>
            <button @click="addToShelf(book)">
              {{ bookshelf.has(book.sourceId, book.bookUrl) ? '已在书架' : '加书架' }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else-if="!loading" class="empty">
      输入关键词开始搜索。当前 `remote/` 下的书源会被自动加载。
    </div>
  </section>
</template>
