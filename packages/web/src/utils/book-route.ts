export function bookRoute(ref: string) {
  return { name: 'book' as const, params: { ref } }
}

export function readRoute(ref: string, chapterIndex = 0) {
  return {
    name: 'read' as const,
    params: { ref, chapterIndex: String(chapterIndex) },
  }
}
