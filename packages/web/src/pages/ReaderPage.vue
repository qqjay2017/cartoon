<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, proxyImage } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'

const route = useRoute()
const bookshelf = useBookshelfStore()

const title = ref(String(route.query.title ?? '阅读'))
const text = ref('')
const images = ref<string[]>([])
const loading = ref(true)
const error = ref('')

const sourceId = String(route.query.sourceId ?? '')
const chapterUrl = String(route.query.url ?? '')
const bookUrl = String(route.query.bookUrl ?? '')

onMounted(async () => {
  if (!sourceId || !chapterUrl) {
    error.value = '缺少章节参数'
    loading.value = false
    return
  }

  try {
    const content = await api.getChapter(sourceId, chapterUrl)
    text.value = content.text ?? ''
    images.value = content.images ?? []

    if (bookUrl) {
      const item = bookshelf.items.find(i => i.sourceId === sourceId && i.bookUrl === bookUrl)
      if (item)
        bookshelf.updateProgress(item.id, chapterUrl, title.value)
    }
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <section v-if="loading" class="panel empty">加载中...</section>
  <section v-else-if="error" class="panel empty">{{ error }}</section>
  <section v-else class="panel">
    <h2>{{ title }}</h2>
    <div v-if="images.length">
      <img
        v-for="(img, index) in images"
        :key="index"
        :src="proxyImage(img)"
        :alt="`${title}-${index + 1}`"
        style="display: block; max-width: 100%; margin: 0 auto 12px;"
      >
    </div>
    <div v-else class="reader-content" v-html="text" />
  </section>
</template>
