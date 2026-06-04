export type ReaderTheme = 'default' | 'light' | 'sepia' | 'night'

export interface ReaderSettings {
  theme: ReaderTheme
  fontSize: number
  lineHeight: number
}

const KEY = 'cartoon-reader-settings'

const DEFAULTS: ReaderSettings = {
  theme: 'light',
  fontSize: 18,
  lineHeight: 1.85,
}

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw)
      return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>
    return {
      theme: parsed.theme ?? DEFAULTS.theme,
      fontSize: clamp(parsed.fontSize ?? DEFAULTS.fontSize, 14, 28),
      lineHeight: clamp(parsed.lineHeight ?? DEFAULTS.lineHeight, 1.4, 2.4),
    }
  }
  catch {
    return { ...DEFAULTS }
  }
}

export function saveReaderSettings(settings: ReaderSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  }
  catch {
    // ignore
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function themeClass(theme: ReaderTheme): string {
  if (theme === 'light')
    return 'theme-light'
  if (theme === 'sepia')
    return 'theme-sepia'
  if (theme === 'night')
    return 'theme-night'
  return ''
}
