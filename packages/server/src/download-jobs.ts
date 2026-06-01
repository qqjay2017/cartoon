import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadProgress, DownloadResult } from '@cartoon/core'

export type DownloadJobStatus = 'running' | 'done' | 'error'

export interface DownloadJob {
  id: string
  status: DownloadJobStatus
  progress: DownloadProgress
  error?: string
  filename?: string
  mimeType?: string
  filePath?: string
  createdAt: number
}

export class DownloadJobManager {
  private jobs = new Map<string, DownloadJob>()

  constructor(private outputDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })
  }

  get(id: string): DownloadJob | undefined {
    return this.jobs.get(id)
  }

  start(run: (onProgress: (progress: DownloadProgress) => void) => Promise<DownloadResult>): string {
    const id = randomUUID()
    const job: DownloadJob = {
      id,
      status: 'running',
      progress: { phase: 'toc', current: 0, total: 1, message: '准备下载' },
      createdAt: Date.now(),
    }
    this.jobs.set(id, job)

    void this.execute(id, run)
    return id
  }

  private async execute(
    id: string,
    run: (onProgress: (progress: DownloadProgress) => void) => Promise<DownloadResult>,
  ) {
    const job = this.jobs.get(id)
    if (!job)
      return

    try {
      const result = await run((progress) => {
        job.progress = progress
      })

      const dir = join(this.outputDir, id)
      await mkdir(dir, { recursive: true })
      const filePath = join(dir, result.filename)
      await writeFile(filePath, result.data)

      job.status = 'done'
      job.filename = result.filename
      job.mimeType = result.mimeType
      job.filePath = filePath
      job.progress = { phase: 'pack', current: 1, total: 1, message: '完成' }
    }
    catch (error) {
      job.status = 'error'
      const message = error instanceof Error ? error.message : 'download failed'
      job.error = message.includes('aborted') || message.includes('Aborted')
        ? '网络超时或连接中断（已自动重试），建议先「缓存全部」再导出'
        : message
    }
  }

  async readFile(id: string): Promise<{ data: Buffer, filename: string, mimeType: string } | null> {
    const job = this.jobs.get(id)
    if (!job?.filePath || job.status !== 'done')
      return null

    const data = await readFile(job.filePath)
    return {
      data,
      filename: job.filename ?? 'download.bin',
      mimeType: job.mimeType ?? 'application/octet-stream',
    }
  }

  async cleanup(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job)
      return

    if (job.filePath) {
      const dir = join(this.outputDir, id)
      await rm(dir, { recursive: true, force: true })
    }
    this.jobs.delete(id)
  }
}
