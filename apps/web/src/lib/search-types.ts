import type { BookSourceType } from '@cartoon/core'

export const SEARCH_TYPE_OPTIONS: { value: BookSourceType, label: string }[] = [
  { value: 0, label: '小说' },
  { value: 2, label: '漫画' },
]

export function parseSearchType(raw: unknown): BookSourceType {
  if (raw === '2' || raw === 2)
    return 2
  return 0
}

export function searchTypeLabel(type: BookSourceType): string {
  return type === 2 ? '漫画' : '小说'
}
