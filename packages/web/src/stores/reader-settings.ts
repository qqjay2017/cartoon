import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'night'
/** paged=单页翻页 scroll=分页滚动 webtoon=条漫连续 */
export type ComicMode = 'paged' | 'scroll' | 'webtoon'
export type ComicFit = 'width' | 'height' | 'original'
export type PageDirection = 'ltr' | 'rtl'
export type NovelMode = 'scroll' | 'paged'

const STORAGE_KEY = 'cartoon-reader-settings'

interface ReaderSettingsState {
  theme: ReaderTheme
  fontSize: number
  lineHeight: number
  comicMode: ComicMode
  comicFit: ComicFit
  pageDirection: PageDirection
  novelMode: NovelMode
  webtoonAutoNext: boolean
  comicAutoCache: boolean
  comicPrefetchCount: number
  showToolbar: boolean
}

function loadSettings(): ReaderSettingsState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ReaderSettingsState> & { comicMode?: string }
    const merged = { ...defaults(), ...raw }
    // 兼容旧版 scroll → 普通滚动
    if (raw.comicMode === 'scroll')
      merged.comicMode = 'scroll'
    return merged
  }
  catch {
    return defaults()
  }
}

function defaults(): ReaderSettingsState {
  return {
    theme: 'dark',
    fontSize: 18,
    lineHeight: 1.9,
    comicMode: 'webtoon',
    comicFit: 'width',
    pageDirection: 'ltr',
    novelMode: 'scroll',
    webtoonAutoNext: true,
    comicAutoCache: true,
    comicPrefetchCount: 100,
    showToolbar: true,
  }
}

export const useReaderSettingsStore = defineStore('reader-settings', () => {
  const saved = loadSettings()
  const theme = ref<ReaderTheme>(saved.theme)
  const fontSize = ref(saved.fontSize)
  const lineHeight = ref(saved.lineHeight)
  const comicMode = ref<ComicMode>(saved.comicMode)
  const comicFit = ref<ComicFit>(saved.comicFit)
  const pageDirection = ref<PageDirection>(saved.pageDirection)
  const novelMode = ref<NovelMode>(saved.novelMode)
  const webtoonAutoNext = ref(saved.webtoonAutoNext)
  const comicAutoCache = ref(saved.comicAutoCache ?? true)
  const comicPrefetchCount = ref(saved.comicPrefetchCount ?? 100)
  const showToolbar = ref(saved.showToolbar)

  watch([theme, fontSize, lineHeight, comicMode, comicFit, pageDirection, novelMode, webtoonAutoNext, comicAutoCache, comicPrefetchCount, showToolbar], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: theme.value,
      fontSize: fontSize.value,
      lineHeight: lineHeight.value,
      comicMode: comicMode.value,
      comicFit: comicFit.value,
      pageDirection: pageDirection.value,
      novelMode: novelMode.value,
      webtoonAutoNext: webtoonAutoNext.value,
      comicAutoCache: comicAutoCache.value,
      comicPrefetchCount: comicPrefetchCount.value,
      showToolbar: showToolbar.value,
    }))
  }, { deep: true })

  function toggleToolbar() {
    showToolbar.value = !showToolbar.value
  }

  function toggleNightMode() {
    theme.value = theme.value === 'night' ? 'dark' : 'night'
  }

  function setTheme(next: ReaderTheme) {
    theme.value = next
  }

  return {
    theme,
    fontSize,
    lineHeight,
    comicMode,
    comicFit,
    pageDirection,
    novelMode,
    webtoonAutoNext,
    comicAutoCache,
    comicPrefetchCount,
    showToolbar,
    toggleToolbar,
    toggleNightMode,
    setTheme,
  }
})
