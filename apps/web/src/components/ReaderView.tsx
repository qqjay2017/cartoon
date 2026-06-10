import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api, getReadingProgress, proxyImage, setReadingProgress } from '~/lib/api'
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

const COMIC_EDGE_RATIO = 0.18

export function ReaderView({ bookshelfId, chapterIndex, onChapterChange }: Props) {
  const bodyRef = useRef<HTMLElement>(null)
  const [settings, setSettings] = useState<ReaderSettings>(() => ({
    theme: 'light',
    fontSize: 18,
    lineHeight: 1.85,
  }))
  const [barsVisible, setBarsVisible] = useState(true)
  const [scrollPct, setScrollPct] = useState(0)
  const [comicPageIndex, setComicPageIndex] = useState(0)
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

  const isComic = book?.sourceType === 2
  const images = content?.images ?? []
  const shouldPadComicCover = images.length > 1 && images.length % 2 === 1

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
    setComicPageIndex(0)
    if (isComic)
      setBarsVisible(false)
  }, [chapterIndex, isComic])

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

  const updateComicPageFromScroll = useCallback(() => {
    const container = bodyRef.current
    if (!container || !images.length)
      return

    const marker = container.scrollTop + container.clientHeight * 0.35
    const pageEls = container.querySelectorAll<HTMLElement>('[data-comic-page]')
    let index = 0
    pageEls.forEach((el, i) => {
      if (el.offsetTop <= marker)
        index = i
    })
    setComicPageIndex(index)
  }, [images.length])

  const handleBodyScroll = useCallback(() => {
    updateScrollProgress()
    if (isComic) {
      updateComicPageFromScroll()
      setBarsVisible(false)
    }
  }, [isComic, updateScrollProgress, updateComicPageFromScroll])

  useEffect(() => {
    if (!isComic || !images.length)
      return

    const root = bodyRef.current
    if (!root)
      return

    const ratios = new Map<number, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.comicPage ?? 0)
          ratios.set(idx, entry.isIntersecting ? entry.intersectionRatio : 0)
        }
        let bestIdx = 0
        let bestRatio = 0
        ratios.forEach((ratio, idx) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestIdx = idx
          }
        })
        if (bestRatio > 0)
          setComicPageIndex(bestIdx)
      },
      {
        root,
        threshold: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1],
      },
    )

    root.querySelectorAll('[data-comic-page]').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [isComic, images, chapterIndex])

  useEffect(() => {
    if (!isComic || tocOpen || settingsOpen)
      return

    function onMouseMove(e: MouseEvent) {
      const y = e.clientY
      const h = window.innerHeight
      if (y < h * COMIC_EDGE_RATIO || y > h * (1 - COMIC_EDGE_RATIO))
        setBarsVisible(true)
    }

    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [isComic, tocOpen, settingsOpen])

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
        if (tocOpen || settingsOpen) {
          setTocOpen(false)
          setSettingsOpen(false)
        }
        else if (isComic) {
          setBarsVisible(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext, isComic, tocOpen, settingsOpen])

  function patchSettings(patch: Partial<ReaderSettings>) {
    setSettings(prev => ({ ...prev, ...patch }))
  }

  function selectChapter(index: number) {
    setTocOpen(false)
    onChapterChange(index)
  }

  function handleComicClick() {
    if (tocOpen || settingsOpen)
      return
    setBarsVisible(v => !v)
  }

  function openPanel(kind: 'toc' | 'settings') {
    if (isComic)
      setBarsVisible(true)
    if (kind === 'toc') {
      setTocOpen(v => !v)
      setSettingsOpen(false)
    }
    else {
      setSettingsOpen(v => !v)
      setTocOpen(false)
    }
  }

  const progressLabel = chapters.length
    ? `第 ${chapterIndex + 1} / ${chapters.length} 章`
    : ''

  return (
    <div className={`reader ${isComic ? 'reader--comic' : ''} ${themeClass(settings.theme)}`}>
      {!isComic && (
        <div
          className="reader-progress-bar"
          style={{ width: `${scrollPct}%` }}
          aria-hidden
        />
      )}

      <header className={`reader-bar ${barsVisible ? '' : 'hidden'}`}>
        <Link
          to="/book/$bookshelfId"
          params={{ bookshelfId }}
          className="reader-btn"
        >
          ← 返回
        </Link>
        <span className="reader-title" title={chapter?.name}>
          {isComic ? (chapter?.name ?? book?.name ?? '阅读') : (book?.name ?? '阅读')}
        </span>
        <button
          type="button"
          className={`reader-btn ${tocOpen ? 'active' : ''}`}
          onClick={() => openPanel('toc')}
        >
          目录
        </button>
        {!isComic && (
          <button
            type="button"
            className={`reader-btn ${settingsOpen ? 'active' : ''}`}
            onClick={() => openPanel('settings')}
          >
            设置
          </button>
        )}
      </header>

      <main
        ref={bodyRef}
        className={isComic ? 'reader-body reader-body--webtoon' : 'reader-body reader-body--novel-paged'}
        onScroll={handleBodyScroll}
        onClick={isComic ? handleComicClick : undefined}
      >
        {isLoading && (
          <div className="reader-loading">章节加载中…</div>
        )}
        {error && !isLoading && (
          <div className="reader-error">
            {error instanceof Error ? error.message : '加载失败'}
          </div>
        )}

        {isComic && !isLoading && !error && chapter && (
          <>
            {images.length > 0
              ? (
                  <div className="reader-comic-scroll">
                    {images.map((src, i) => (
                      <Fragment key={`${i}-${src}`}>
                        <img
                          data-comic-page={i}
                          src={proxyImage(src)}
                          alt=""
                          loading={i < 2 ? 'eager' : 'lazy'}
                        />
                        {i === 0 && shouldPadComicCover && (
                          <div
                            className="reader-comic-spread-placeholder"
                            aria-hidden
                          />
                        )}
                      </Fragment>
                    ))}
                  </div>
                )
              : (
                  <p className="reader-empty-chapter">本章暂无图片，请尝试下一话。</p>
                )}
            {images.length > 0 && (
              <div
                className={`reader-page-indicator reader-page-indicator--scroll ${barsVisible ? 'with-bars' : ''}`}
                aria-live="polite"
              >
                {comicPageIndex + 1}
                /
                {images.length}
              </div>
            )}
          </>
        )}

        {!isComic && !isLoading && !error && chapter && (
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

        {!isComic && (
          <div className="reader-novel-tap-layer" aria-hidden>
            <button type="button" title="上一章" onClick={goPrev} />
            <button
              type="button"
              title="显示工具栏"
              onClick={() => setBarsVisible(v => !v)}
            />
            <button type="button" title="下一章" onClick={goNext} />
          </div>
        )}
      </main>

      <footer className={`reader-bar reader-bar--footer ${barsVisible ? '' : 'hidden'}`}>
        <button type="button" className="reader-btn" disabled={!hasPrev} onClick={goPrev}>
          {isComic ? '上一话' : '上一章'}
        </button>
        <span className="reader-progress">{progressLabel}</span>
        <button type="button" className="reader-btn primary" disabled={!hasNext} onClick={goNext}>
          {isComic ? '下一话' : '下一章'}
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

      {settingsOpen && !isComic && (
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
