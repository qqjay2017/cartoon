<script setup lang="ts">
import type { ChapterItem } from '../api/client'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, proxyImage } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderSettingsStore } from '../stores/reader-settings'

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

const sourceId = String(route.query.sourceId ?? '')
const chapterUrl = String(route.query.url ?? '')
const bookUrl = String(route.query.bookUrl ?? '')
const tocUrl = String(route.query.tocUrl ?? '')
const sourceType = Number(route.query.sourceType ?? 0)

const isComic = computed(() => sourceType === 2)
const isPagedComic = computed(() => isComic.value && settings.comicMode === 'paged')
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
  if (isComic.value && images.value.length)
    return `${pageIndex.value + 1} / ${images.value.length}`
  if (chapters.value.length && currentChapterIndex.value >= 0)
    return `${currentChapterIndex.value + 1} / ${chapters.value.length} 章`
  return ''
})
const novelStyle = computed(() => ({
  fontSize: `${settings.fontSize}px`,
  lineHeight: String(settings.lineHeight),
}))

function normalizeUrl(url: string) {
  try {
    return new URL(url, window.location.origin).href
  }
  catch {
    return url
  }
}

async function loadChapter(url: string, chapterTitle: string) {
  loading.value = true
  error.value = ''
  pageIndex.value = 0

  try {
    const content = await api.getChapter(sourceId, url)
    text.value = content.text ?? ''
    images.value = content.images ?? []
    title.value = chapterTitle

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

function onKeydown(event: KeyboardEvent) {
  if (showSettings.value || showToc.value)
    return

  switch (event.key) {
    case 'ArrowLeft':
    case 'PageUp':
      event.preventDefault()
      if (isPagedComic.value)
        prevPage()
      else
        prevChapter()
      break
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      event.preventDefault()
      if (isPagedComic.value)
        nextPage()
      else
        nextChapter()
      break
    case 'ArrowUp':
      event.preventDefault()
      prevChapter()
      break
    case 'ArrowDown':
      event.preventDefault()
      nextChapter()
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

  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="reader" :class="[`theme-${settings.theme}`]">
    <header class="reader-bar" :class="{ hidden: !settings.showToolbar }">
      <button class="reader-btn" type="button" @click="goBack">返回</button>
      <div class="reader-title">{{ title }}</div>
      <button class="reader-btn" type="button" @click="showToc = true">目录</button>
      <button class="reader-btn" type="button" @click="showSettings = true">设置</button>
    </header>

    <div v-if="loading" class="reader-loading">加载中...</div>
    <div v-else-if="error" class="reader-error">{{ error }}</div>

    <main
      v-else
      class="reader-body"
      :class="{ 'reader-body--paged': isPagedComic }"
      tabindex="0"
      @click="settings.toggleToolbar()"
    >
      <!-- 漫画：单页翻页 -->
      <div v-if="isPagedComic && images.length" class="reader-comic-page">
        <button
          type="button"
          class="reader-tap-zone reader-tap-zone--prev"
          aria-label="上一页"
          @click.stop="prevPage"
        />
        <img
          :src="proxyImage(images[pageIndex])"
          :alt="`${title}-${pageIndex + 1}`"
          :class="imageFitClass"
          @click.stop
        >
        <button
          type="button"
          class="reader-tap-zone reader-tap-zone--next"
          aria-label="下一页"
          @click.stop="nextPage"
        />
      </div>

      <!-- 漫画：纵向滚动 -->
      <div v-else-if="isComic && images.length" class="reader-comic-scroll" @click.stop>
        <img
          v-for="(img, index) in images"
          :key="index"
          :src="proxyImage(img)"
          :alt="`${title}-${index + 1}`"
        >
      </div>

      <!-- 小说 -->
      <article v-else class="reader-novel" @click.stop>
        <div class="reader-novel-content" :style="novelStyle" v-html="text" />
      </article>
    </main>

    <footer class="reader-bar reader-bar--footer" :class="{ hidden: !settings.showToolbar }">
      <button class="reader-btn" type="button" :disabled="!hasPrevChapter" @click="prevChapter">
        上一章
      </button>
      <div class="reader-progress">{{ progressText }}</div>
      <div v-if="isPagedComic" class="reader-progress" style="display: flex; gap: 8px;">
        <button class="reader-btn" type="button" :disabled="pageIndex <= 0 && !hasPrevChapter" @click="prevPage">
          上一页
        </button>
        <button class="reader-btn primary" type="button" :disabled="pageIndex >= images.length - 1 && !hasNextChapter" @click="nextPage">
          下一页
        </button>
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
          <select v-model="settings.theme">
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="sepia">护眼</option>
          </select>
        </div>

        <template v-if="!isComic">
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
            <label>阅读模式</label>
            <select v-model="settings.comicMode">
              <option value="paged">单页翻页</option>
              <option value="scroll">纵向滚动</option>
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
        </template>

        <p class="meta" style="margin-top: 8px;">
          快捷键：←/→ 翻页，↑/↓ 切换章节，Esc 显隐工具栏
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
