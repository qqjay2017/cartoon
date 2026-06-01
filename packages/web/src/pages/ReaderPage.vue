<script setup lang="ts">
import type { ChapterItem } from '../api/client'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, proxyImage, type BookCacheStatus } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderSettingsStore, type ReaderTheme } from '../stores/reader-settings'

const route = useRoute()
const router = useRouter()
const bookshelf = useBookshelfStore()
const settings = useReaderSettingsStore()

const title = ref(String(route.query.title ?? '阅读'))
const text = ref('')
const images = ref<string[]>([])
const chapters = ref<ChapterItem[]>([])
const loading = ref(true)
const error = ref('')
const pageIndex = ref(0)
const showSettings = ref(false)
const showToc = ref(false)
const scrollProgress = ref(0)
const readerBodyRef = ref<HTMLElement | null>(null)
const autoNextLock = ref(false)
const skipRouteReload = ref(false)
const cacheStatus = ref<BookCacheStatus | null>(null)
const cacheHint = ref('')
let cachePollTimer: ReturnType<typeof setInterval> | undefined

const sourceId = String(route.query.sourceId ?? '')
const chapterUrl = String(route.query.url ?? '')
const bookUrl = String(route.query.bookUrl ?? '')
const tocUrl = String(route.query.tocUrl ?? '')
const sourceType = Number(route.query.sourceType ?? 0)

const isComic = computed(() => sourceType === 2)
const isWebtoon = computed(() => isComic.value && settings.comicMode === 'webtoon')
const isScrollComic = computed(() => isComic.value && settings.comicMode === 'scroll')
const isPagedComic = computed(() => isComic.value && settings.comicMode === 'paged')
const isNovelPaged = computed(() => !isComic.value && settings.novelMode === 'paged')
const isRtl = computed(() => settings.pageDirection === 'rtl')

const currentChapterIndex = computed(() =>
  chapters.value.findIndex(ch => ch.url === chapterUrl || normalizeUrl(ch.url) === normalizeUrl(chapterUrl)),
)
const hasPrevChapter = computed(() => currentChapterIndex.value > 0)
const hasNextChapter = computed(() =>
  currentChapterIndex.value >= 0 && currentChapterIndex.value < chapters.value.length - 1,
)

const imageFitClass = computed(() => {
  switch (settings.comicFit) {
    case 'height': return 'fit-height'
    case 'original': return 'fit-original'
    default: return 'fit-width'
  }
})

const progressText = computed(() => {
  if (isPagedComic.value && images.value.length)
    return `${pageIndex.value + 1} / ${images.value.length}`
  if (isWebtoon.value || isScrollComic.value)
    return `${Math.round(scrollProgress.value)}%`
  if (chapters.value.length && currentChapterIndex.value >= 0)
    return `${currentChapterIndex.value + 1} / ${chapters.value.length} 章`
  return ''
})

const novelStyle = computed(() => ({
  fontSize: `${settings.fontSize}px`,
  lineHeight: String(settings.lineHeight),
}))

const bodyClass = computed(() => ({
  'reader-body--paged': isPagedComic.value,
  'reader-body--webtoon': isWebtoon.value,
  'reader-body--novel-paged': isNovelPaged.value,
}))

const themeOptions: Array<{ id: ReaderTheme, label: string, preview: string }> = [
  { id: 'light', label: '日间', preview: 'theme-light-preview' },
  { id: 'sepia', label: '护眼', preview: 'theme-sepia-preview' },
  { id: 'dark', label: '深色', preview: 'theme-dark-preview' },
  { id: 'night', label: '夜间', preview: 'theme-night-preview' },
]

function normalizeUrl(url: string) {
  try {
    return new URL(url, window.location.origin).href
  }
  catch {
    return url
  }
}

const cacheProgressText = computed(() => {
  if (!isComic.value || !cacheStatus.value)
    return ''
  const { cachedChapters, totalChapters, caching, progress } = cacheStatus.value
  if (caching && progress)
    return `缓存 ${progress.current}/${progress.total}`
  if (cachedChapters > 0)
    return `已缓存 ${cachedChapters}/${totalChapters || chapters.value.length}`
  return ''
})

async function refreshCacheStatus() {
  if (!isComic.value || !bookUrl)
    return

  try {
    cacheStatus.value = await api.getCacheStatus(sourceId, bookUrl, chapters.value.length)
    if (cacheStatus.value.caching && !cachePollTimer)
      cachePollTimer = setInterval(refreshCacheStatus, 2000)
    else if (!cacheStatus.value.caching && cachePollTimer) {
      clearInterval(cachePollTimer)
      cachePollTimer = undefined
    }
  }
  catch {
    // ignore
  }
}

function triggerComicPrefetch(chapterUrl: string) {
  if (!isComic.value || !bookUrl || !settings.comicAutoCache)
    return

  void api.prefetchCache(
    sourceId,
    bookUrl,
    chapterUrl,
    settings.comicPrefetchCount,
  ).then(() => refreshCacheStatus()).catch(() => {})
}

async function cacheAllComic() {
  if (!isComic.value || !bookUrl)
    return

  cacheHint.value = ''
  try {
    const result = await api.cacheAll(sourceId, bookUrl)
    cacheHint.value = result.alreadyRunning ? '缓存任务进行中' : '已开始缓存全部'
    await refreshCacheStatus()
  }
  catch (e) {
    cacheHint.value = e instanceof Error ? e.message : '启动缓存失败'
  }
}

async function loadChapter(url: string, chapterTitle: string) {
  loading.value = true
  error.value = ''
  pageIndex.value = 0
  scrollProgress.value = 0

  try {
    const content = await api.getChapter(sourceId, url, bookUrl || undefined)
    text.value = content.text ?? ''
    images.value = content.images ?? []
    title.value = chapterTitle

    if (isComic.value && bookUrl)
      triggerComicPrefetch(url)

    if (bookUrl) {
      const item = bookshelf.items.find(i => i.sourceId === sourceId && i.bookUrl === bookUrl)
      if (item)
        bookshelf.updateProgress(item.id, url, chapterTitle)
    }
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  }
  finally {
    loading.value = false
    autoNextLock.value = false
    requestAnimationFrame(() => {
      if (isWebtoon.value && readerBodyRef.value)
        readerBodyRef.value.scrollTop = 0
    })
  }
}

async function loadToc() {
  if (!bookUrl)
    return

  try {
    const resolvedTocUrl = tocUrl || bookUrl
    const toc = await api.getToc(sourceId, resolvedTocUrl)
    chapters.value = toc.chapters
  }
  catch {
    chapters.value = []
  }
}

function updateScrollProgress() {
  const el = readerBodyRef.value
  if (!el)
    return

  const max = el.scrollHeight - el.clientHeight
  scrollProgress.value = max > 0 ? (el.scrollTop / max) * 100 : 100

  if (isWebtoon.value && settings.webtoonAutoNext && hasNextChapter.value && !autoNextLock.value && !loading.value) {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100)
      autoLoadNextChapter()
  }
}

async function autoLoadNextChapter() {
  const nextIndex = currentChapterIndex.value + 1
  if (nextIndex >= chapters.value.length || autoNextLock.value || loading.value)
    return

  const next = chapters.value[nextIndex]!
  autoNextLock.value = true

  try {
    const content = await api.getChapter(sourceId, next.url, bookUrl || undefined)
    images.value.push(...(content.images ?? []))
    title.value = next.name

    skipRouteReload.value = true
    await router.replace({
      name: 'read',
      query: {
        sourceId,
        url: next.url,
        bookUrl,
        tocUrl,
        sourceType: String(sourceType),
        title: next.name,
      },
    })

    if (bookUrl) {
      const item = bookshelf.items.find(i => i.sourceId === sourceId && i.bookUrl === bookUrl)
      if (item)
        bookshelf.updateProgress(item.id, next.url, next.name)
    }
  }
  catch {
    // ignore auto load failure
  }
  finally {
    autoNextLock.value = false
  }
}

function goBack() {
  if (bookUrl) {
    router.push({ name: 'book', query: { sourceId, url: bookUrl } })
    return
  }
  router.back()
}

function openChapter(chapter: ChapterItem) {
  showToc.value = false
  router.replace({
    name: 'read',
    query: {
      sourceId,
      url: chapter.url,
      bookUrl,
      tocUrl,
      sourceType: String(sourceType),
      title: chapter.name,
    },
  })
}

function prevChapter() {
  if (!hasPrevChapter.value)
    return
  openChapter(chapters.value[currentChapterIndex.value - 1]!)
}

function nextChapter() {
  if (!hasNextChapter.value)
    return
  openChapter(chapters.value[currentChapterIndex.value + 1]!)
}

function prevPage() {
  if (!isComic.value || !images.value.length)
    return

  if (pageIndex.value > 0) {
    pageIndex.value--
    return
  }
  prevChapter()
}

function nextPage() {
  if (!isComic.value || !images.value.length)
    return

  if (pageIndex.value < images.value.length - 1) {
    pageIndex.value++
    return
  }
  nextChapter()
}

function onTapPrev() {
  if (isPagedComic.value)
    isRtl.value ? nextPage() : prevPage()
  else if (isNovelPaged.value)
    novelScrollPage('prev')
}

function onTapNext() {
  if (isPagedComic.value)
    isRtl.value ? prevPage() : nextPage()
  else if (isNovelPaged.value)
    novelScrollPage('next')
}

function novelScrollPage(direction: 'prev' | 'next') {
  const el = readerBodyRef.value
  if (!el)
    return

  const amount = Math.floor(el.clientHeight * 0.88)
  el.scrollBy({
    top: direction === 'next' ? amount : -amount,
    behavior: 'smooth',
  })
}

function onKeydown(event: KeyboardEvent) {
  if (showSettings.value || showToc.value)
    return

  const key = event.key

  if (key === 'n' || key === 'N') {
    settings.toggleNightMode()
    return
  }

  if (isPagedComic.value) {
    const goPrev = isRtl.value
      ? key === 'ArrowRight' || key === 'PageDown' || key === ' '
      : key === 'ArrowLeft' || key === 'PageUp'
    const goNext = isRtl.value
      ? key === 'ArrowLeft' || key === 'PageUp'
      : key === 'ArrowRight' || key === 'PageDown' || key === ' '

    if (goPrev) {
      event.preventDefault()
      prevPage()
      return
    }
    if (goNext) {
      event.preventDefault()
      nextPage()
      return
    }
  }

  if (isNovelPaged.value) {
    if (key === 'ArrowLeft' || key === 'PageUp') {
      event.preventDefault()
      novelScrollPage('prev')
      return
    }
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
      event.preventDefault()
      novelScrollPage('next')
      return
    }
  }

  if (isWebtoon.value || isScrollComic.value) {
    if (key === ' ' || key === 'ArrowDown' || key === 'PageDown') {
      event.preventDefault()
      readerBodyRef.value?.scrollBy({ top: readerBodyRef.value.clientHeight * 0.9, behavior: 'smooth' })
      return
    }
    if (key === 'ArrowUp' || key === 'PageUp') {
      event.preventDefault()
      readerBodyRef.value?.scrollBy({ top: -readerBodyRef.value.clientHeight * 0.9, behavior: 'smooth' })
      return
    }
  }

  switch (key) {
    case 'ArrowUp':
      event.preventDefault()
      prevChapter()
      break
    case 'ArrowDown':
      if (!isWebtoon.value && !isScrollComic.value) {
        event.preventDefault()
        nextChapter()
      }
      break
    case 'Escape':
      if (showSettings.value || showToc.value) {
        showSettings.value = false
        showToc.value = false
      }
      else {
        settings.toggleToolbar()
      }
      break
  }
}

watch(
  () => [route.query.url, route.query.title],
  async ([url, chapterTitle]) => {
    if (!url)
      return
    if (skipRouteReload.value) {
      skipRouteReload.value = false
      return
    }
    await loadChapter(String(url), String(chapterTitle ?? '阅读'))
  },
)

onMounted(async () => {
  if (!sourceId || !chapterUrl) {
    error.value = '缺少章节参数'
    loading.value = false
    return
  }

  await Promise.all([
    loadChapter(chapterUrl, title.value),
    loadToc(),
  ])
  await refreshCacheStatus()

  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (cachePollTimer)
    clearInterval(cachePollTimer)
})
</script>

<template>
  <div class="reader" :class="[`theme-${settings.theme}`]">
    <header class="reader-bar" :class="{ hidden: !settings.showToolbar }">
      <button class="reader-btn" type="button" @click="goBack">返回</button>
      <div class="reader-title">{{ title }}</div>
      <button
        class="reader-btn"
        :class="{ active: settings.theme === 'night' }"
        type="button"
        title="切换夜间模式 (N)"
        @click="settings.toggleNightMode()"
      >
        夜间
      </button>
      <button class="reader-btn" type="button" @click="showToc = true">目录</button>
      <button
        v-if="isComic && bookUrl"
        class="reader-btn"
        type="button"
        :disabled="cacheStatus?.caching"
        @click="cacheAllComic"
      >
        缓存全部
      </button>
      <button class="reader-btn" type="button" @click="showSettings = true">设置</button>
    </header>

    <div v-if="loading" class="reader-loading">加载中...</div>
    <div v-else-if="error" class="reader-error">{{ error }}</div>

    <main
      v-else
      ref="readerBodyRef"
      class="reader-body"
      :class="bodyClass"
      tabindex="0"
      @scroll="updateScrollProgress"
      @click="settings.toggleToolbar()"
    >
      <div
        v-if="(isWebtoon || isScrollComic || isNovelPaged) && scrollProgress > 0"
        class="reader-progress-bar"
        :style="{ width: `${scrollProgress}%` }"
      />

      <!-- 漫画：单页翻页 -->
      <div v-if="isPagedComic && images.length" class="reader-comic-page" :class="`fit-${settings.comicFit}`">
        <button type="button" class="reader-tap-zone reader-tap-zone--prev" aria-label="上一页" @click.stop="onTapPrev" />
        <button type="button" class="reader-tap-zone reader-tap-zone--center" aria-label="显隐工具栏" @click.stop="settings.toggleToolbar()" />
        <button type="button" class="reader-tap-zone reader-tap-zone--next" aria-label="下一页" @click.stop="onTapNext" />
        <img
          :key="pageIndex"
          :src="proxyImage(images[pageIndex])"
          :alt="`${title}-${pageIndex + 1}`"
          :class="imageFitClass"
          @click.stop
        >
        <div class="reader-page-indicator">
          {{ pageIndex + 1 }} / {{ images.length }}
          <span v-if="isRtl"> · 日漫</span>
        </div>
      </div>

      <!-- 漫画：条漫连续 -->
      <div v-else-if="isWebtoon && images.length" class="reader-comic-webtoon" @click.stop>
        <img
          v-for="(img, index) in images"
          :key="index"
          :src="proxyImage(img)"
          :alt="`${title}-${index + 1}`"
          :class="imageFitClass"
          loading="lazy"
        >
        <div v-if="hasNextChapter && settings.webtoonAutoNext" class="reader-webtoon-hint">
          继续下滑自动加载下一话
        </div>
        <div v-else-if="!hasNextChapter" class="reader-webtoon-hint">已读完</div>
      </div>

      <!-- 漫画：普通纵向滚动 -->
      <div v-else-if="isScrollComic && images.length" class="reader-comic-scroll" @click.stop>
        <img
          v-for="(img, index) in images"
          :key="index"
          :src="proxyImage(img)"
          :alt="`${title}-${index + 1}`"
          :class="imageFitClass"
          loading="lazy"
        >
      </div>

      <!-- 小说 -->
      <article v-else class="reader-novel" @click.stop>
        <div class="reader-novel-content" :style="novelStyle" v-html="text" />
      </article>

      <!-- 小说点击翻页热区 -->
      <div v-if="isNovelPaged && !isComic" class="reader-novel-tap-layer">
        <button type="button" aria-label="上一页" @click.stop="onTapPrev" />
        <button type="button" aria-label="下一页" @click.stop="onTapNext" />
      </div>
    </main>

    <footer class="reader-bar reader-bar--footer" :class="{ hidden: !settings.showToolbar }">
      <button class="reader-btn" type="button" :disabled="!hasPrevChapter" @click="prevChapter">
        上一章
      </button>
      <div class="reader-progress">
        {{ progressText }}
        <span v-if="cacheProgressText" class="reader-cache-hint"> · {{ cacheProgressText }}</span>
      </div>
      <div v-if="isPagedComic" style="display: flex; gap: 8px;">
        <button class="reader-btn" type="button" @click="onTapPrev">上一页</button>
        <button class="reader-btn primary" type="button" @click="onTapNext">下一页</button>
      </div>
      <button class="reader-btn primary" type="button" :disabled="!hasNextChapter" @click="nextChapter">
        下一章
      </button>
    </footer>

    <div v-if="showSettings" class="reader-drawer-backdrop" @click="showSettings = false" />
    <aside v-if="showSettings" class="reader-drawer">
      <div class="reader-drawer-header">
        <span>阅读设置</span>
        <button class="reader-btn" type="button" @click="showSettings = false">关闭</button>
      </div>
      <div class="reader-drawer-body">
        <div class="reader-setting-row">
          <label>主题</label>
          <div class="reader-theme-grid">
            <button
              v-for="item in themeOptions"
              :key="item.id"
              type="button"
              class="reader-theme-chip"
              :class="[item.preview, { active: settings.theme === item.id }]"
              @click="settings.setTheme(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <template v-if="!isComic">
          <div class="reader-setting-row">
            <label>阅读方式</label>
            <select v-model="settings.novelMode">
              <option value="scroll">连续滚动</option>
              <option value="paged">点击/按键翻页</option>
            </select>
          </div>
          <div class="reader-setting-row">
            <label>字号：{{ settings.fontSize }}px</label>
            <input v-model.number="settings.fontSize" type="range" min="14" max="28" step="1">
          </div>
          <div class="reader-setting-row">
            <label>行距：{{ settings.lineHeight }}</label>
            <input v-model.number="settings.lineHeight" type="range" min="1.4" max="2.4" step="0.1">
          </div>
        </template>

        <template v-else>
          <div class="reader-setting-row">
            <label>漫画模式</label>
            <select v-model="settings.comicMode">
              <option value="webtoon">条漫（连续下滑）</option>
              <option value="paged">单页翻页</option>
              <option value="scroll">分页滚动</option>
            </select>
          </div>
          <div v-if="settings.comicMode === 'webtoon'" class="reader-setting-row reader-setting-toggle">
            <label>滑到底自动下一话</label>
            <input v-model="settings.webtoonAutoNext" type="checkbox">
          </div>
          <div v-if="settings.comicMode === 'paged'" class="reader-setting-row">
            <label>翻页方向</label>
            <select v-model="settings.pageDirection">
              <option value="ltr">左页 → 右页（国漫/韩漫）</option>
              <option value="rtl">右页 → 左页（日漫）</option>
            </select>
          </div>
          <div class="reader-setting-row">
            <label>图片适配</label>
            <select v-model="settings.comicFit">
              <option value="width">适应宽度</option>
              <option value="height">适应高度</option>
              <option value="original">原始尺寸</option>
            </select>
          </div>
          <div class="reader-setting-row reader-setting-toggle">
            <label>阅读时自动缓存后续章节</label>
            <input v-model="settings.comicAutoCache" type="checkbox">
          </div>
          <div v-if="settings.comicAutoCache" class="reader-setting-row">
            <label>预缓存章数：{{ settings.comicPrefetchCount }}</label>
            <input v-model.number="settings.comicPrefetchCount" type="range" min="10" max="200" step="10">
          </div>
          <p v-if="cacheHint" class="meta">{{ cacheHint }}</p>
        </template>

        <p class="meta" style="margin-top: 8px; line-height: 1.6;">
          快捷键：N 夜间模式 · Esc 显隐工具栏<br>
          单页：←/→ 翻页 · 条漫：空格/↓ 滚动 · ↑/↓ 换章
        </p>
      </div>
    </aside>

    <div v-if="showToc" class="reader-drawer-backdrop" @click="showToc = false" />
    <aside v-if="showToc" class="reader-drawer reader-drawer--left">
      <div class="reader-drawer-header">
        <span>目录</span>
        <button class="reader-btn" type="button" @click="showToc = false">关闭</button>
      </div>
      <div class="reader-drawer-body">
        <button
          v-for="(chapter, index) in chapters"
          :key="chapter.url"
          type="button"
          class="reader-toc-item"
          :class="{ active: index === currentChapterIndex }"
          @click="openChapter(chapter)"
        >
          {{ chapter.name }}
        </button>
        <p v-if="!chapters.length" class="meta">暂无目录</p>
      </div>
    </aside>
  </div>
</template>
