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
const reloadingMeta = ref(false)
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
    const toc = await api.getToc(sourceId.value, bookUrl.value)
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
      const label = isComic.value ? 'CBZ' : DOWNLOAD_FORMAT_LABELS[downloadFormat.value]
      downloadMessage.value = `已导出 ${result.exportedFiles.length} 个 ${label} 到 ${result.exportDir}：${files}`
    }
  }
  catch (e) {
    downloadError.value = e instanceof Error ? e.message : '下载失败'
  }
  finally {
    downloading.value = false
    downloadJob.value = null
    await refreshCacheStatus()
  }
}

async function cacheAll() {
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

async function reloadBookMeta() {
  if (!detail.value || reloadingMeta.value || isComic.value)
    return

  reloadingMeta.value = true
  cacheError.value = ''
  cacheMessage.value = ''

  try {
    const result = await api.reloadBookMeta(sourceId.value, bookUrl.value)
    detail.value = result.book
    chapters.value = result.chapters
    catalog.update(bookRef.value, {
      name: result.book.name,
      author: result.book.author,
      coverUrl: result.book.coverUrl,
      tocUrl: result.book.tocUrl,
    })
    cacheMessage.value = '已重载书籍信息、目录与封面'
    await refreshCacheStatus()
  }
  catch (e) {
    cacheError.value = e instanceof Error ? e.message : '重载失败'
  }
  finally {
    reloadingMeta.value = false
  }
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
  <section v-else-if="detail" class="panel book-detail">
    <div class="book-header">
      <div class="book-cover">
        <img
          v-if="detail.coverUrl"
          :src="proxyImage(detail.coverUrl)"
          :alt="detail.name"
          width="140"
          height="180"
        >
      </div>
      <div class="book-main">
        <h1 class="book-title">{{ detail.name }}</h1>
        <p class="book-tags meta">
          <span v-if="detail.author">作者：{{ detail.author }}</span>
          <span v-if="detail.wordCount">{{ detail.wordCount }}</span>
          <span v-if="detail.kind">{{ detail.kind }}</span>
          <span>书源：{{ detail.sourceName }}</span>
          <span v-if="chapters.length">共 {{ chapters.length }} 章</span>
        </p>

        <div v-if="detail.intro" class="book-intro reader-content" v-html="detail.intro" />

        <hr class="book-divider">

        <div class="actions book-actions">
          <button class="primary" @click="addToShelf">
            {{ bookshelf.has(detail.sourceId, detail.bookUrl) ? '已在书架' : '加入书架' }}
          </button>
          <button
            v-if="chapters.length"
            class="primary"
            @click="readChapter(chapters[0], 0)"
          >
            开始阅读
          </button>
          <select v-model="downloadFormat" class="download-format" :disabled="downloading">
            <option v-for="item in formatOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <button :disabled="downloading" @click="downloadBook">
            {{ downloading ? `导出中 ${downloadPercent}%` : (isComic && downloadFormat === 'cbz' ? '导出 CBZ 到本地' : (!isComic ? '下载到本地缓存' : '整本下载导出')) }}
          </button>
          <button v-if="!isComic" :disabled="reloadingMeta || downloading" @click="reloadBookMeta">
            {{ reloadingMeta ? '重载中...' : '重载配置' }}
          </button>
        </div>

        <div v-if="downloading" class="download-progress-wrap">
          <div class="download-progress-bar">
            <div class="download-progress-fill" :style="{ width: `${downloadPercent}%` }" />
          </div>
          <p class="meta">{{ downloadStatusText }}</p>
        </div>
        <p v-if="downloadError" class="meta book-hint" style="color: #f87171;">{{ downloadError }}</p>
        <p v-else-if="downloadMessage" class="meta book-hint">{{ downloadMessage }}</p>
        <p v-else-if="isComic && downloadFormat === 'cbz'" class="meta book-hint">
          漫画 CBZ 按每 100 章分卷，导出后保存在本地缓存目录，不会触发浏览器下载。
        </p>
        <p v-else-if="!isComic" class="meta book-hint">
          小说下载会抓取章节并写入本地缓存目录（cache/novels/书源名/哈希），同时生成 EPUB/TXT，不会触发浏览器下载。
        </p>
        <p v-else-if="!downloading && cacheStatus?.cachedChapters" class="meta book-hint">
          导出时将优先读取本地缓存（已缓存 {{ cacheStatus.cachedChapters }}/{{ chapters.length }} 章），缺失章节会并发下载并写入缓存。
        </p>

        <hr v-if="detail.lastChapter" class="book-divider">

        <p v-if="detail.lastChapter" class="meta">
          最新章节：{{ detail.lastChapter }}
        </p>

        <div class="cache-panel">
          <h3 class="cache-panel-title">本地缓存</h3>
          <p v-if="cacheProgressText" class="meta">{{ cacheProgressText }}</p>
          <div class="actions cache-actions">
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
          <p v-if="cacheMessage" class="meta book-hint">{{ cacheMessage }}</p>
          <p v-if="cacheError" class="meta book-hint" style="color: #f87171;">{{ cacheError }}</p>
        </div>
      </div>
    </div>

    <h3 class="book-toc-title">目录</h3>
    <div class="chapter-list">
      <button
        v-for="(chapter, index) in chapters"
        :key="chapter.url"
        class="chapter-item"
        @click="readChapter(chapter, index)"
      >
        <span>{{ chapter.name }}</span>
        <span v-if="chapter.updateTime" class="meta">{{ chapter.updateTime }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.book-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.book-cover {
  flex: 0 0 140px;
  width: 140px;
  padding: 4px;
  border: 1px solid var(--border, #2a3140);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  line-height: 0;
}

.book-cover img {
  width: 140px;
  height: 180px;
  display: block;
  object-fit: contain;
  background: #222;
}

.book-main {
  flex: 1;
  min-width: 0;
}

.book-title {
  margin: 0 0 10px;
  font-size: 1.5rem;
  line-height: 1.35;
  font-weight: 600;
}

.book-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0 0 12px;
}

.book-intro {
  margin: 0 0 4px;
  line-height: 1.75;
  text-align: justify;
}

.book-divider {
  border: none;
  border-top: 1px solid var(--border, #2a3140);
  margin: 14px 0;
}

.book-actions {
  margin-top: 0;
}

.book-hint {
  margin-top: 8px;
}

.book-toc-title {
  margin: 28px 0 12px;
  font-size: 1rem;
}

.chapter-item {
  width: 100%;
  text-align: left;
  background: none;
  color: inherit;
  cursor: pointer;
}

.cache-panel-title {
  margin: 16px 0 10px;
  font-size: 1rem;
}

.cache-actions {
  margin-top: 10px;
}

@media (max-width: 640px) {
  .book-header {
    flex-direction: column;
    align-items: center;
  }

  .book-main {
    width: 100%;
  }

  .book-title {
    text-align: center;
  }

  .book-tags {
    justify-content: center;
  }
}

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
