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
  type DownloadJobSnapshot,
} from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'
import { useBookCatalogStore } from '../stores/book-catalog'
import { readRoute } from '../utils/book-route'

const route = useRoute()
const router = useRouter()
const bookshelf = useBookshelfStore()
const catalog = useBookCatalogStore()

const bookRef = computed(() => String(route.params.ref ?? ''))
const catalogBook = computed(() => catalog.get(bookRef.value))

const detail = ref<BookDetailResponse | null>(null)
const chapters = ref<ChapterItem[]>([])
const loading = ref(true)
const error = ref('')
const downloading = ref(false)
const downloadError = ref('')
const downloadMessage = ref('')
const downloadFormat = ref<DownloadFormat>('epub')
const downloadJob = ref<DownloadJobSnapshot | null>(null)

const downloadPercent = computed(() => {
  const progress = downloadJob.value?.progress
  if (!progress)
    return 0
  if (progress.phase === 'toc')
    return 8
  if (progress.phase === 'pack') {
    if (progress.total > 1)
      return Math.min(98, Math.round(90 + (progress.current / progress.total) * 8))
    return 98
  }
  if (!progress.total)
    return 10
  return Math.min(95, Math.round(10 + (progress.current / progress.total) * 85))
})

const downloadStatusText = computed(() => {
  const progress = downloadJob.value?.progress
  if (!progress)
    return '准备整本下载...'
  if (progress.phase === 'toc')
    return progress.message ?? '获取目录'
  if (progress.phase === 'pack') {
    if (progress.total > 1)
      return `${progress.message ?? '正在打包'} (${progress.current}/${progress.total})`
    return progress.message ?? '正在打包'
  }
  const cacheHint = progress.cachedChapters
    ? ` · 已用缓存 ${progress.cachedChapters} 章`
    : ''
  return `${progress.current}/${progress.total} 章 · ${progress.message ?? ''}${cacheHint}`
})
const cacheStatus = ref<BookCacheStatus | null>(null)
const cacheDirInput = ref('')
const cacheMessage = ref('')
const cacheError = ref('')
const clearConfirmStep = ref(0)
let cachePollTimer: ReturnType<typeof setInterval> | undefined

const sourceId = computed(() => catalogBook.value?.sourceId ?? '')
const bookUrl = computed(() => catalogBook.value?.bookUrl ?? '')

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
    cacheStatus.value = await api.getCacheStatus(sourceId.value, bookUrl.value, chapters.value.length)
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
    cacheDirInput.value = isComic.value ? config.comicDir : (config.novelDir ?? config.comicDir)
  }
  catch {
    // ignore
  }
}

onMounted(async () => {
  if (!catalogBook.value) {
    error.value = '书籍不存在，请从搜索页重新打开'
    loading.value = false
    return
  }

  try {
    detail.value = await api.getBook(sourceId.value, bookUrl.value)
    catalog.update(bookRef.value, {
      name: detail.value.name,
      author: detail.value.author,
      coverUrl: detail.value.coverUrl,
      tocUrl: detail.value.tocUrl,
    })
    const toc = await api.getToc(sourceId.value, detail.value.tocUrl ?? bookUrl.value)
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

  catalog.register({
    sourceId: detail.value.sourceId,
    sourceName: detail.value.sourceName,
    sourceType: detail.value.sourceType,
    bookUrl: detail.value.bookUrl,
    name: detail.value.name,
    author: detail.value.author,
    coverUrl: detail.value.coverUrl,
    tocUrl: detail.value.tocUrl,
  })

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

function readChapter(chapter: ChapterItem, index: number) {
  catalog.setReading(bookRef.value, {
    chapterIndex: index,
    chapterUrl: chapter.url,
    chapterName: chapter.name,
  })
  router.push(readRoute(bookRef.value, index))
}

async function downloadBook() {
  if (!detail.value || downloading.value)
    return

  downloading.value = true
  downloadError.value = ''
  downloadMessage.value = ''
  downloadJob.value = null

  try {
    const result = await api.downloadBookWithProgress(
      detail.value.sourceId,
      detail.value.bookUrl,
      downloadFormat.value,
      (job) => {
        downloadJob.value = job
      },
    )

    if ('localExport' in result && result.localExport) {
      const files = result.exportedFiles.join('、')
      downloadMessage.value = `已导出 ${result.exportedFiles.length} 个 CBZ 到 ${result.exportDir}：${files}`
    }
  }
  catch (e) {
    downloadError.value = e instanceof Error ? e.message : '下载失败'
  }
  finally {
    downloading.value = false
    downloadJob.value = null
    if (isComic.value)
      await refreshCacheStatus()
  }
}

async function cacheAll() {
  if (!isComic.value)
    return

  cacheError.value = ''
  cacheMessage.value = ''

  try {
    const result = await api.cacheAll(sourceId.value, bookUrl.value)
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
    await api.clearCache(sourceId.value, bookUrl.value)
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
    const result = await api.setCacheConfig(cacheDirInput.value.trim(), isComic.value ? 'comic' : 'novel')
    cacheDirInput.value = isComic.value
      ? (result.comicDir ?? cacheDirInput.value)
      : (result.novelDir ?? cacheDirInput.value)
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
        <p class="meta">书源：{{ detail.sourceName }}</p>
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
            {{ downloading ? `导出中 ${downloadPercent}%` : (isComic && downloadFormat === 'cbz' ? '导出 CBZ 到本地' : '整本下载导出') }}
          </button>
        </div>
        <div v-if="downloading" class="download-progress-wrap">
          <div class="download-progress-bar">
            <div class="download-progress-fill" :style="{ width: `${downloadPercent}%` }" />
          </div>
          <p class="meta">{{ downloadStatusText }}</p>
        </div>
        <p v-if="downloadError" class="meta" style="color: #f87171; margin-top: 8px;">{{ downloadError }}</p>
        <p v-else-if="downloadMessage" class="meta" style="margin-top: 8px;">{{ downloadMessage }}</p>
        <p v-else-if="isComic && downloadFormat === 'cbz'" class="meta" style="margin-top: 8px;">
          漫画 CBZ 按每 100 章分卷，导出后保存在本地缓存目录，不会触发浏览器下载。
        </p>
        <p v-else-if="!downloading && cacheStatus?.cachedChapters" class="meta" style="margin-top: 8px;">
          导出时将优先读取本地缓存（已缓存 {{ cacheStatus.cachedChapters }}/{{ chapters.length }} 章），缺失章节会并发下载并写入缓存。
        </p>

        <div class="cache-panel">
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
            <input
              v-model="cacheDirInput"
              class="cache-dir-input"
              type="text"
              :placeholder="isComic ? 'cache/comics 或绝对路径' : 'cache/novels 或绝对路径'"
            >
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
        v-for="(chapter, index) in chapters"
        :key="chapter.url"
        class="chapter-item"
        style="width: 100%; text-align: left; background: none; color: inherit; cursor: pointer;"
        @click="readChapter(chapter, index)"
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

.download-progress-wrap {
  margin-top: 12px;
}

.download-progress-bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.download-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6ea8fe, #38bdf8);
  transition: width 0.25s ease;
}
</style>
