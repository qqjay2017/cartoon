export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length)
    return []

  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (true) {
      const index = nextIndex++
      if (index >= items.length)
        return
      results[index] = await worker(items[index]!, index)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  )
  await Promise.all(workers)
  return results
}
