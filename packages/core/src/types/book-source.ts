/** Legado 书源类型：0=文字小说，2=漫画 */
export type BookSourceType = 0 | 2

export interface SearchRule {
  bookList?: string
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  wordCount?: string
  coverUrl?: string
  bookUrl?: string
}

export interface BookInfoRule {
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  wordCount?: string
  coverUrl?: string
  tocUrl?: string
}

export interface TocRule {
  chapterList?: string
  chapterName?: string
  chapterUrl?: string
  updateTime?: string
}

export interface ContentRule {
  content?: string
  imageStyle?: string
  replaceRegex?: string
}

export interface BookSource {
  bookSourceName: string
  bookSourceUrl: string
  bookSourceType: BookSourceType
  bookSourceGroup?: string
  enabled?: boolean
  enabledCookieJar?: boolean
  header?: string
  searchUrl?: string
  ruleSearch?: SearchRule
  ruleBookInfo?: BookInfoRule
  ruleToc?: TocRule
  ruleContent?: ContentRule
  jsLib?: string
  loginUrl?: string
}

export interface SearchBook {
  sourceId: string
  sourceName: string
  sourceType: BookSourceType
  name: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  wordCount?: string
  coverUrl?: string
  bookUrl: string
}

export interface BookDetail extends SearchBook {
  tocUrl?: string
}

export interface Chapter {
  name: string
  url: string
  updateTime?: string
}

export interface ChapterContent {
  /** 小说正文 HTML 或纯文本 */
  text?: string
  /** 漫画图片 URL 列表 */
  images?: string[]
}

export interface BookshelfItem {
  id: string
  sourceId: string
  sourceName: string
  sourceType: BookSourceType
  name: string
  author?: string
  coverUrl?: string
  bookUrl: string
  lastReadChapterUrl?: string
  lastReadChapterName?: string
  addedAt: number
}
