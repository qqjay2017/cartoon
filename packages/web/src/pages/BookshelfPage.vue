<script setup lang="ts">
import { useRouter } from 'vue-router'
import { proxyImage } from '../api/client'
import { useBookshelfStore } from '../stores/bookshelf'

const router = useRouter()
const bookshelf = useBookshelfStore()

function openBook(item: { sourceId: string, bookUrl: string }) {
  router.push({
    name: 'book',
    query: {
      sourceId: item.sourceId,
      url: item.bookUrl,
    },
  })
}

function continueRead(item: { sourceId: string, lastReadChapterUrl?: string }) {
  if (!item.lastReadChapterUrl)
    return

  router.push({
    name: 'read',
    query: {
      sourceId: item.sourceId,
      url: item.lastReadChapterUrl,
    },
  })
}
</script>

<template>
  <section class="panel">
    <h2>我的书架</h2>
    <div v-if="bookshelf.items.length" class="grid">
      <article v-for="item in bookshelf.items" :key="item.id" class="card">
        <div class="card-cover" @click="openBook(item)">
          <img v-if="item.coverUrl" :src="proxyImage(item.coverUrl)" :alt="item.name">
          <span v-else>{{ item.name.slice(0, 1) }}</span>
        </div>
        <div class="card-body">
          <div class="card-title">{{ item.name }}</div>
          <div class="meta">{{ item.sourceName }}</div>
          <div v-if="item.lastReadChapterName" class="meta">
            读到：{{ item.lastReadChapterName }}
          </div>
          <div class="actions">
            <button class="primary" @click="openBook(item)">详情</button>
            <button
              v-if="item.lastReadChapterUrl"
              @click="continueRead(item)"
            >
              继续阅读
            </button>
            <button @click="bookshelf.remove(item.id)">移除</button>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="empty">书架还是空的，去搜索页添加吧。</div>
  </section>
</template>
