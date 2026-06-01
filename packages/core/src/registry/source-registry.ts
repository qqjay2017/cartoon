import type { LoadedSource } from '../loader/source-loader.js'
import { BookService } from '../engine/book-service.js'
import type { BookSourceType, SearchBook } from '../types/book-source.js'

export class SourceRegistry {
  private sources = new Map<string, LoadedSource>()

  constructor(
    sources: LoadedSource[],
    private bookService: BookService,
  ) {
    for (const source of sources)
      this.sources.set(source.id, source)
  }

  list(type?: BookSourceType) {
    const all = [...this.sources.values()]
    return type === undefined ? all : all.filter(s => s.bookSourceType === type)
  }

  get(id: string) {
    return this.sources.get(id)
  }

  async searchAll(keyword: string, type?: BookSourceType): Promise<SearchBook[]> {
    const targets = this.list(type)
    const batches = await Promise.allSettled(
      targets.map(source => this.bookService.search(source, keyword)),
    )

    return batches.flatMap((result, index) => {
      if (result.status === 'fulfilled')
        return result.value

      console.warn(`[search] ${targets[index]?.bookSourceName} failed:`, result.reason)
      return []
    })
  }
}
