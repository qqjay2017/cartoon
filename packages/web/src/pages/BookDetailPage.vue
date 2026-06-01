<script setup lang="ts">
import type { ChapterItem } from '../api/client'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, proxyImage, type BookDetailResponse } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'

const route = useRoute()
const router = useRouter()
const bookshelf = useBookshelfStore()

const detail = ref<BookDetailResponse | null>(null)
const chapters = ref<ChapterItem[]>([])
const loading = ref(true)
const error = ref('')
const downloading = ref(false)
const downloadError = ref('')

const sourceId = String(route.query.sourceId ?? '')
const bookUrl = String(route.query.url ?? '')

const downloadFormat = computed(() => detail.value?.sourceType === 2 ? 'cbz' : 'epub')
const downloadLabel = computed(() => detail.value?.sourceType === 2 ? '下载 CBZ' : '下载 EPUB')

onMounted(async () => {
  if (!sourceId || !bookUrl) {
    error.value = '缺少书籍参数'
    loading.value = false
    return
  }

  try {
    detail.value = await api.getBook(sourceId, bookUrl)
    const toc = await api.getToc(sourceId, detail.value.tocUrl ?? bookUrl)
    chapters.value = toc.chapters
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  }
  finally {
    loading.value = false
  }
})

function addToShelf() {
  if (!detail.value)
    return

  bookshelf.add({
    sourceId: detail.value.sourceId,
    sourceName: detail.value.sourceName,
    sourceType: detail.value.sourceType,
    name: detail.value.name,
    author: detail.value.author,
    coverUrl: detail.value.coverUrl,
    bookUrl: detail.value.bookUrl,
  })
}

function readChapter(chapter: ChapterItem) {
  router.push({
    name: 'read',
    query: {
      sourceId,
      url: chapter.url,
      bookUrl,
      tocUrl: detail.value?.tocUrl ?? bookUrl,
      sourceType: String(detail.value?.sourceType ?? 0),
      title: chapter.name,
    },
  })
}

async function downloadBook() {
  if (!detail.value || downloading.value)
    return

  downloading.value = true
  downloadError.value = ''

  try {
    const { blob, filename } = await api.downloadBook(
      detail.value.sourceId,
      detail.value.bookUrl,
      downloadFormat.value,
    )

    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }
  catch (e) {
    downloadError.value = e instanceof Error ? e.message : '下载失败'
  }
  finally {
    downloading.value = false
  }
}
</script>

<template>
  <section v-if="loading" class="panel empty">加载中...</section>
  <section v-else-if="error" class="panel empty">{{ error }}</section>
  <section v-else-if="detail" class="panel">
    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
      <div class="card-cover" style="width: 180px; border-radius: 12px;">
        <img v-if="detail.coverUrl" :src="proxyImage(detail.coverUrl)" :alt="detail.name">
      </div>
      <div style="flex: 1; min-width: 240px;">
        <h2>{{ detail.name }}</h2>
        <p v-if="detail.author" class="meta">作者：{{ detail.author }}</p>
        <p v-if="detail.kind" class="meta">分类：{{ detail.kind }}</p>
        <p v-if="detail.lastChapter" class="meta">最新章节：{{ detail.lastChapter }}</p>
        <p v-if="chapters.length" class="meta">共 {{ chapters.length }} 章</p>
        <div class="actions">
          <button class="primary" @click="addToShelf">
            {{ bookshelf.has(detail.sourceId, detail.bookUrl) ? '已在书架' : '加入书架' }}
          </button>
          <button :disabled="downloading" @click="downloadBook">
            {{ downloading ? '打包下载中...' : downloadLabel }}
          </button>
        </div>
        <p v-if="downloadError" class="meta" style="color: #f87171; margin-top: 8px;">{{ downloadError }}</p>
        <p v-else-if="downloading" class="meta" style="margin-top: 8px;">
          正在抓取全部章节并打包，漫画体积较大时请耐心等待。
        </p>
        <div v-if="detail.intro" class="reader-content" style="margin-top: 16px;" v-html="detail.intro" />
      </div>
    </div>

    <h3 style="margin-top: 28px;">目录</h3>
    <div class="chapter-list">
      <button
        v-for="chapter in chapters"
        :key="chapter.url"
        class="chapter-item"
        style="width: 100%; text-align: left; background: none; color: inherit; cursor: pointer;"
        @click="readChapter(chapter)"
      >
        <span>{{ chapter.name }}</span>
        <span v-if="chapter.updateTime" class="meta">{{ chapter.updateTime }}</span>
      </button>
    </div>
  </section>
</template>
