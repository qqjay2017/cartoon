<script setup lang="ts">
import type { ChapterItem } from '../api/client'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  DOWNLOAD_FORMAT_LABELS,
  proxyImage,
  type BookCacheStatus,
  type BookDetailResponse,
  type DownloadFormat,
} from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'
import { buildReadRouteQuery } from '../utils/route-query'

const route = useRoute()
const router = useRouter()
const bookshelf = useBookshelfStore()

const detail = ref<BookDetailResponse | null>(null)
const chapters = ref<ChapterItem[]>([])
const loading = ref(true)
const error = ref('')
const downloading = ref(false)
const downloadError = ref('')
const downloadFormat = ref<DownloadFormat>('epub')
const cacheStatus = ref<BookCacheStatus | null>(null)
const cacheDirInput = ref('')
const cacheMessage = ref('')
const cacheError = ref('')
const clearConfirmStep = ref(0)
let cachePollTimer: ReturnType<typeof setInterval> | undefined

const sourceId = String(route.query.sourceId ?? '')
const bookUrl = String(route.query.url ?? '')

const isComic = computed(() => detail.value?.sourceType === 2)

const formatOptions = computed<Array<{ value: DownloadFormat, label: string }>>(() => {
  if (detail.value?.sourceType === 2) {
    return [
      { value: 'cbz', label: DOWNLOAD_FORMAT_LABELS.cbz },
      { value: 'folder', label: DOWNLOAD_FORMAT_LABELS.folder },
    ]
  }
  return [
    { value: 'epub', label: DOWNLOAD_FORMAT_LABELS.epub },
    { value: 'txt', label: DOWNLOAD_FORMAT_LABELS.txt },
  ]
})

const cacheProgressText = computed(() => {
  if (!cacheStatus.value)
    return ''
  const { cachedChapters, totalChapters, caching, progress } = cacheStatus.value
  if (caching && progress)
    return `缓存中 ${progress.current}/${progress.total}${progress.message ? ` · ${progress.message}` : ''}`
  return `已缓存 ${cachedChapters}/${totalChapters || chapters.value.length} 章`
})

watch(detail, (value) => {
  downloadFormat.value = value?.sourceType === 2 ? 'cbz' : 'epub'
}, { immediate: true })

async function refreshCacheStatus() {
  if (!isComic.value)
    return

  try {
    cacheStatus.value = await api.getCacheStatus(sourceId, bookUrl, chapters.value.length)
    if (cacheStatus.value.caching) {
      if (!cachePollTimer) {
        cachePollTimer = setInterval(refreshCacheStatus, 2000)
      }
    }
    else if (cachePollTimer) {
      clearInterval(cachePollTimer)
      cachePollTimer = undefined
    }
  }
  catch {
    // ignore polling errors
  }
}

async function loadCacheConfig() {
  try {
    const config = await api.getCacheConfig()
    cacheDirInput.value = config.comicDir
  }
  catch {
    // ignore
  }
}

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
    await Promise.all([loadCacheConfig(), refreshCacheStatus()])
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  }
  finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (cachePollTimer)
    clearInterval(cachePollTimer)
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
    query: buildReadRouteQuery({
      sourceId,
      url: chapter.url,
      bookUrl,
      tocUrl: detail.value?.tocUrl ?? bookUrl,
      sourceType: detail.value?.sourceType ?? 0,
      title: chapter.name,
    }),
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

async function cacheAll() {
  if (!isComic.value)
    return

  cacheError.value = ''
  cacheMessage.value = ''

  try {
    const result = await api.cacheAll(sourceId, bookUrl)
    cacheMessage.value = result.alreadyRunning ? '缓存任务已在进行中' : '已开始缓存全部章节'
    await refreshCacheStatus()
  }
  catch (e) {
    cacheError.value = e instanceof Error ? e.message : '启动缓存失败'
  }
}

async function clearCache() {
  if (clearConfirmStep.value === 0) {
    clearConfirmStep.value = 1
    cacheMessage.value = '请再次点击「确认清空」以删除本地缓存'
    return
  }

  cacheError.value = ''
  try {
    await api.clearCache(sourceId, bookUrl)
    cacheMessage.value = '缓存已清空'
    clearConfirmStep.value = 0
    await refreshCacheStatus()
  }
  catch (e) {
    cacheError.value = e instanceof Error ? e.message : '清空失败'
    clearConfirmStep.value = 0
  }
}

function cancelClearCache() {
  clearConfirmStep.value = 0
  cacheMessage.value = ''
}

async function saveCacheDir() {
  cacheError.value = ''
  try {
    const result = await api.setCacheConfig(cacheDirInput.value.trim())
    cacheDirInput.value = result.comicDir
    cacheMessage.value = '缓存目录已更新'
  }
  catch (e) {
    cacheError.value = e instanceof Error ? e.message : '保存目录失败'
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
          <select v-model="downloadFormat" class="download-format" :disabled="downloading">
            <option v-for="item in formatOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <button :disabled="downloading" @click="downloadBook">
            {{ downloading ? '打包下载中...' : '下载导出' }}
          </button>
        </div>
        <p v-if="downloadError" class="meta" style="color: #f87171; margin-top: 8px;">{{ downloadError }}</p>
        <p v-else-if="downloading" class="meta" style="margin-top: 8px;">
          正在抓取全部章节并打包{{ isComic && cacheStatus?.cachedChapters ? '（优先使用本地缓存）' : '' }}，请耐心等待。
        </p>

        <div v-if="isComic" class="cache-panel">
          <h3 style="margin: 20px 0 10px; font-size: 1rem;">本地缓存</h3>
          <p v-if="cacheProgressText" class="meta">{{ cacheProgressText }}</p>
          <div class="actions" style="margin-top: 10px;">
            <button :disabled="cacheStatus?.caching" @click="cacheAll">
              {{ cacheStatus?.caching ? '缓存进行中...' : '缓存全部' }}
            </button>
            <button
              v-if="clearConfirmStep === 0"
              class="danger"
              :disabled="!cacheStatus?.cachedChapters && !cacheStatus?.caching"
              @click="clearCache"
            >
              清空缓存
            </button>
            <button v-else class="danger" @click="clearCache">确认清空</button>
            <button v-if="clearConfirmStep === 1" @click="cancelClearCache">取消</button>
          </div>
          <div class="cache-dir-row">
            <label class="meta">缓存目录</label>
            <input v-model="cacheDirInput" class="cache-dir-input" type="text" placeholder="项目内 cache/comics 或绝对路径">
            <button @click="saveCacheDir">保存目录</button>
          </div>
          <p v-if="cacheMessage" class="meta" style="margin-top: 8px;">{{ cacheMessage }}</p>
          <p v-if="cacheError" class="meta" style="color: #f87171; margin-top: 8px;">{{ cacheError }}</p>
        </div>

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

<style scoped>
.download-format {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a3140);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  min-width: 140px;
}

.cache-panel {
  margin-top: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--border, #2a3140);
}

.cache-dir-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}

.cache-dir-input {
  flex: 1;
  min-width: 220px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a3140);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
}

.actions button.danger {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.35);
}
</style>
