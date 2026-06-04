import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  ownsFile?: boolean
  localExport?: boolean
  exportDir?: string
  exportedFiles?: string[]
  createdAt: number
}

export interface DownloadJobFile {
  path: string
  filename: string
  mimeType: string
  size: number
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
      const result = await run(progress => { job.progress = progress })

      if (result.localExport) {
        job.localExport = true
        job.exportDir = result.exportDir
        job.exportedFiles = result.exportedFiles
        job.filename = result.exportedFiles?.[0] ?? result.filename
        job.mimeType = result.mimeType
        job.status = 'done'
        job.progress = {
          phase: 'pack',
          current: result.exportedFiles?.length ?? 1,
          total: result.exportedFiles?.length ?? 1,
          message: result.exportDir ? `已保存到 ${result.exportDir}` : '完成',
        }
        return
      }

      if (result.filePath) {
        job.filePath = result.filePath
        job.ownsFile = false
      }
      else if (result.data) {
        const dir = join(this.outputDir, id)
        await mkdir(dir, { recursive: true })
        job.filePath = join(dir, result.filename)
        await writeFile(job.filePath, result.data)
        job.ownsFile = true
      }
      else {
        throw new Error('download result missing data or filePath')
      }

      job.status = 'done'
      job.filename = result.filename
      job.mimeType = result.mimeType
      job.progress = { phase: 'pack', current: 1, total: 1, message: '完成' }
    }
    catch (error) {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : 'download failed'
    }
  }

  async getFile(id: string): Promise<DownloadJobFile | null> {
    const job = this.jobs.get(id)
    if (!job?.filePath || job.status !== 'done')
      return null
    const info = await stat(job.filePath)
    return {
      path: job.filePath,
      filename: job.filename ?? 'download.bin',
      mimeType: job.mimeType ?? 'application/octet-stream',
      size: info.size,
    }
  }

  async cleanup(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job)
      return
    if (job.filePath && job.ownsFile)
      await rm(join(this.outputDir, id), { recursive: true, force: true })
    this.jobs.delete(id)
  }
}
