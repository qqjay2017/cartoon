import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getReadingProgress, setReadingProgress } from '~/lib/api'
import {
  loadReaderSettings,
  saveReaderSettings,
  themeClass,
  type ReaderSettings,
  type ReaderTheme,
} from '~/lib/reader-settings'

interface Props {
  bookshelfId: string
  chapterIndex: number
  onChapterChange: (index: number) => void
}

export function ReaderView({ bookshelfId, chapterIndex, onChapterChange }: Props) {
  const bodyRef = useRef<HTMLElement>(null)
  const [settings, setSettings] = useState<ReaderSettings>(() => ({
    theme: 'light',
    fontSize: 18,
    lineHeight: 1.85,
  }))
  const [barsVisible, setBarsVisible] = useState(true)
  const [scrollPct, setScrollPct] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data: book } = useQuery({
    queryKey: ['book', bookshelfId],
    queryFn: () => api.getBook(bookshelfId),
  })

  const { data: tocData } = useQuery({
    queryKey: ['toc', bookshelfId],
    queryFn: () => api.getToc(bookshelfId),
  })

  const chapters = tocData?.chapters ?? []
  const chapter = chapters[chapterIndex]
  const chapterId = chapter?.id ?? String(chapterIndex)

  const { data: content, isLoading, error } = useQuery({
    queryKey: ['chapter', bookshelfId, chapterId],
    queryFn: () => api.getChapter(bookshelfId, chapterId),
    enabled: Boolean(chapter),
  })

  useEffect(() => {
    setSettings(loadReaderSettings())
  }, [])

  useEffect(() => {
    if (chapter) {
      void api.updateProgress(bookshelfId, chapterId, chapter.name)
      setReadingProgress(bookshelfId, chapterIndex, chapterId)
    }
  }, [bookshelfId, chapterIndex, chapterId, chapter])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    setScrollPct(0)
  }, [chapterIndex])

  useEffect(() => {
    saveReaderSettings(settings)
  }, [settings])

  const hasPrev = chapterIndex > 0
  const hasNext = chapterIndex < chapters.length - 1

  const goPrev = useCallback(() => {
    if (hasPrev)
      onChapterChange(chapterIndex - 1)
  }, [hasPrev, chapterIndex, onChapterChange])

  const goNext = useCallback(() => {
    if (hasNext)
      onChapterChange(chapterIndex + 1)
  }, [hasNext, chapterIndex, onChapterChange])

  const updateScrollProgress = useCallback(() => {
    const el = bodyRef.current
    if (!el)
      return
    const max = el.scrollHeight - el.clientHeight
    setScrollPct(max > 0 ? (el.scrollTop / max) * 100 : 0)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')
        return
      if (e.key === 'ArrowLeft')
        goPrev()
      else if (e.key === 'ArrowRight')
        goNext()
      else if (e.key === 'Enter' && !e.shiftKey)
        setTocOpen(true)
      else if (e.key === 'Escape') {
        setTocOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext])

  function patchSettings(patch: Partial<ReaderSettings>) {
    setSettings(prev => ({ ...prev, ...patch }))
  }

  function selectChapter(index: number) {
    setTocOpen(false)
    onChapterChange(index)
  }

  const progressLabel = chapters.length
    ? `第 ${chapterIndex + 1} / ${chapters.length} 章`
    : ''

  return (
    <div className={`reader ${themeClass(settings.theme)}`}>
      <div
        className="reader-progress-bar"
        style={{ width: `${scrollPct}%` }}
        aria-hidden
      />

      <header className={`reader-bar ${barsVisible ? '' : 'hidden'}`}>
        <Link
          to="/book/$bookshelfId"
          params={{ bookshelfId }}
          className="reader-btn"
        >
          ← 返回
        </Link>
        <span className="reader-title" title={chapter?.name}>
          {book?.name ?? '阅读'}
        </span>
        <button
          type="button"
          className={`reader-btn ${tocOpen ? 'active' : ''}`}
          onClick={() => { setTocOpen(v => !v); setSettingsOpen(false) }}
        >
          目录
        </button>
        <button
          type="button"
          className={`reader-btn ${settingsOpen ? 'active' : ''}`}
          onClick={() => { setSettingsOpen(v => !v); setTocOpen(false) }}
        >
          设置
        </button>
      </header>

      <main
        ref={bodyRef}
        className="reader-body reader-body--novel-paged"
        onScroll={updateScrollProgress}
      >
        {isLoading && (
          <div className="reader-loading">章节加载中…</div>
        )}
        {error && !isLoading && (
          <div className="reader-error">
            {error instanceof Error ? error.message : '加载失败'}
          </div>
        )}
        {!isLoading && !error && chapter && (
          <div
            className="reader-novel"
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
            }}
          >
            <header className="reader-chapter-head">
              <h1 className="reader-chapter-heading">{chapter.name}</h1>
              {(book?.name || book?.author) && (
                <p className="reader-book-meta">
                  {book?.name}
                  {book?.author ? ` · ${book.author}` : ''}
                </p>
              )}
            </header>

            {content?.text
              ? (
                  <article
                    className="reader-novel-content"
                    dangerouslySetInnerHTML={{ __html: content.text }}
                  />
                )
              : !content?.images?.length && (
                  <p className="reader-empty-chapter">本章暂无正文，请尝试下一章。</p>
                )}

            {content?.images?.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                className="reader-chapter-image"
              />
            ))}

            {content?.cached && (
              <p className="reader-cache-hint">已离线缓存</p>
            )}

            <nav className="reader-chapter-actions" aria-label="章节导航">
              <button
                type="button"
                className="reader-btn"
                disabled={!hasPrev}
                onClick={goPrev}
              >
                上一章
              </button>
              <button
                type="button"
                className="reader-btn primary"
                onClick={() => setTocOpen(true)}
              >
                章节目录
              </button>
              <button
                type="button"
                className="reader-btn primary"
                disabled={!hasNext}
                onClick={goNext}
              >
                下一章
              </button>
            </nav>

            <p className="reader-chapter-footer-hint">
              ← → 切换章节 · Enter 打开目录 · 点击正文区域显示/隐藏工具栏
            </p>
          </div>
        )}

        <div className="reader-novel-tap-layer" aria-hidden>
          <button type="button" title="上一章" onClick={goPrev} />
          <button
            type="button"
            title="显示工具栏"
            onClick={() => setBarsVisible(v => !v)}
          />
          <button type="button" title="下一章" onClick={goNext} />
        </div>
      </main>

      <footer className={`reader-bar reader-bar--footer ${barsVisible ? '' : 'hidden'}`}>
        <button type="button" className="reader-btn" disabled={!hasPrev} onClick={goPrev}>
          上一章
        </button>
        <span className="reader-progress">{progressLabel}</span>
        <button type="button" className="reader-btn primary" disabled={!hasNext} onClick={goNext}>
          下一章
        </button>
      </footer>

      {(tocOpen || settingsOpen) && (
        <button
          type="button"
          className="reader-drawer-backdrop"
          aria-label="关闭面板"
          onClick={() => { setTocOpen(false); setSettingsOpen(false) }}
        />
      )}

      {tocOpen && (
        <aside className="reader-drawer reader-drawer--left" role="dialog" aria-label="章节目录">
          <div className="reader-drawer-header">
            <span>目录</span>
            <button type="button" className="reader-btn" onClick={() => setTocOpen(false)}>关闭</button>
          </div>
          <div className="reader-drawer-body">
            {chapters.length === 0 && <p className="reader-loading">目录加载中…</p>}
            {chapters.map((ch, index) => (
              <button
                key={ch.id ?? ch.url ?? index}
                type="button"
                className={`reader-toc-item ${index === chapterIndex ? 'active' : ''}`}
                onClick={() => selectChapter(index)}
              >
                {ch.name}
              </button>
            ))}
          </div>
        </aside>
      )}

      {settingsOpen && (
        <aside className="reader-drawer" role="dialog" aria-label="阅读设置">
          <div className="reader-drawer-header">
            <span>阅读设置</span>
            <button type="button" className="reader-btn" onClick={() => setSettingsOpen(false)}>关闭</button>
          </div>
          <div className="reader-drawer-body">
            <div className="reader-setting-row">
              <label>背景主题</label>
              <div className="reader-theme-grid">
                {([
                  ['light', '护眼白', 'theme-light-preview'],
                  ['sepia', '羊皮纸', 'theme-sepia-preview'],
                  ['default', '深色', 'theme-dark-preview'],
                  ['night', '夜间', 'theme-night-preview'],
                ] as const).map(([id, label, preview]) => (
                  <button
                    key={id}
                    type="button"
                    className={`reader-theme-chip ${preview} ${settings.theme === id ? 'active' : ''}`}
                    onClick={() => patchSettings({ theme: id as ReaderTheme })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="reader-setting-row">
              <label>
                字号
                {' '}
                {settings.fontSize}
                px
              </label>
              <input
                type="range"
                min={14}
                max={28}
                step={1}
                value={settings.fontSize}
                onChange={e => patchSettings({ fontSize: Number(e.target.value) })}
              />
            </div>
            <div className="reader-setting-row">
              <label>
                行距
                {' '}
                {settings.lineHeight.toFixed(2)}
              </label>
              <input
                type="range"
                min={1.4}
                max={2.4}
                step={0.05}
                value={settings.lineHeight}
                onChange={e => patchSettings({ lineHeight: Number(e.target.value) })}
              />
            </div>
            {getReadingProgress(bookshelfId) && (
              <p className="reader-cache-hint">
                本地记录：第
                {' '}
                {(getReadingProgress(bookshelfId)?.chapterIndex ?? 0) + 1}
                {' '}
                章
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
