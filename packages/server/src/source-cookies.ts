import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface CookieStoreFile {
  [sourceId: string]: string
}

export class SourceCookieStore {
  private cache = new Map<string, string>()

  constructor(private filePath: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.filePath, '..'), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const data = JSON.parse(raw) as CookieStoreFile
      for (const [key, value] of Object.entries(data))
        this.cache.set(key, value)
    }
    catch {
      // fresh store
    }
  }

  get(sourceId: string): string | undefined {
    const value = this.cache.get(sourceId)?.trim()
    return value || undefined
  }

  async set(sourceId: string, cookies: string): Promise<string> {
    const trimmed = cookies.trim()
    if (trimmed)
      this.cache.set(sourceId, trimmed)
    else
      this.cache.delete(sourceId)
    await this.persist()
    return trimmed
  }

  has(sourceId: string): boolean {
    return Boolean(this.get(sourceId))
  }

  private async persist(): Promise<void> {
    const data: CookieStoreFile = Object.fromEntries(this.cache.entries())
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

export function formatCloudflare403Hint(sourceName?: string, flareSolverrConfigured?: boolean): string {
  const site = sourceName ?? '该站点'
  if (flareSolverrConfigured) {
    return `${site} 返回 403（Cloudflare）。已启用 FlareSolverr 但请求仍失败，请确认 FlareSolverr 正在运行且 NO_PROXY 包含 localhost（如 export NO_PROXY=localhost,127.0.0.1）。`
  }
  return `${site} 返回 403（Cloudflare）。浏览器复制的 Cookie 无法在 Node 服务端直接使用（Cloudflare 会校验 TLS 指纹与 IP）。请启动 FlareSolverr 并设置 export FLARESOLVERR_URL=http://127.0.0.1:8191，或在同一代理环境下由 FlareSolverr 自动过验证。`
}
