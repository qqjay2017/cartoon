import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ReaderTheme = 'dark' | 'light' | 'sepia'
export type ComicMode = 'scroll' | 'paged'
export type ComicFit = 'width' | 'height' | 'original'

const STORAGE_KEY = 'cartoon-reader-settings'

interface ReaderSettingsState {
  theme: ReaderTheme
  fontSize: number
  lineHeight: number
  comicMode: ComicMode
  comicFit: ComicFit
  showToolbar: boolean
}

function loadSettings(): ReaderSettingsState {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ReaderSettingsState> }
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
    comicMode: 'paged',
    comicFit: 'width',
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
  const showToolbar = ref(saved.showToolbar)

  watch([theme, fontSize, lineHeight, comicMode, comicFit, showToolbar], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: theme.value,
      fontSize: fontSize.value,
      lineHeight: lineHeight.value,
      comicMode: comicMode.value,
      comicFit: comicFit.value,
      showToolbar: showToolbar.value,
    }))
  }, { deep: true })

  function toggleToolbar() {
    showToolbar.value = !showToolbar.value
  }

  return {
    theme,
    fontSize,
    lineHeight,
    comicMode,
    comicFit,
    showToolbar,
    toggleToolbar,
  }
})
