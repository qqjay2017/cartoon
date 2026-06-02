<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, proxyImage, type SearchBook, type SourceSummary } from '../api/client'
import { useBookCatalogStore } from '../stores/book-catalog'
import { useBookshelfStore } from '../stores/bookshelf'
import { bookRoute } from '../utils/book-route'

const router = useRouter()
const bookshelf = useBookshelfStore()
const catalog = useBookCatalogStore()

const keyword = ref('')
const type = ref<'all' | '0' | '2'>('all')
const loading = ref(false)
const error = ref('')
const results = ref<SearchBook[]>([])

const sources = ref<SourceSummary[]>([])
const manualSourceId = ref('')
const manualUrl = ref('')
const manualLoading = ref(false)
const manualError = ref('')

const cookieText = ref('')
const cookieConfigured = ref(false)
const cookieSaving = ref(false)
const cookieMessage = ref('')

const selectedManualSource = computed(() =>
  sources.value.find(source => source.id === manualSourceId.value),
)
const needsCookieJar = computed(() => Boolean(selectedManualSource.value?.cookieJar))

async function loadSourceCookies() {
  if (!manualSourceId.value || !needsCookieJar.value) {
    cookieText.value = ''
    cookieConfigured.value = false
    return
  }

  try {
    const data = await api.getSourceCookies(manualSourceId.value)
    cookieText.value = data.cookies
    cookieConfigured.value = data.configured
  }
  catch {
    cookieText.value = ''
    cookieConfigured.value = false
  }
}

watch(manualSourceId, () => {
  cookieMessage.value = ''
  void loadSourceCookies()
})

onMounted(async () => {
  try {
    sources.value = await api.listSources(0)
    manualSourceId.value = sources.value.find(s => s.name.includes('69'))?.id
      ?? sources.value[0]?.id
      ?? ''
    await loadSourceCookies()
  }
  catch {
    // ignore
  }
})

async function saveSourceCookies() {
  if (!manualSourceId.value)
    return

  cookieSaving.value = true
  cookieMessage.value = ''
  try {
    const data = await api.setSourceCookies(manualSourceId.value, cookieText.value)
    cookieConfigured.value = data.configured
    cookieMessage.value = data.configured ? 'Cookie 已保存' : 'Cookie 已清除'
  }
  catch (e) {
    cookieMessage.value = e instanceof Error ? e.message : '保存失败'
  }
  finally {
    cookieSaving.value = false
  }
}

async function search() {
  if (!keyword.value.trim())
    return

  loading.value = true
  error.value = ''
  try {
    const parsedType = type.value === 'all' ? undefined : Number(type.value) as 0 | 2
    const data = await api.search(keyword.value.trim(), parsedType)
    results.value = data.results
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '搜索失败'
  }
  finally {
    loading.value = false
  }
}

async function openByManualUrl() {
  if (!manualSourceId.value || !manualUrl.value.trim())
    return

  manualLoading.value = true
  manualError.value = ''
  try {
    const detail = await api.openBookByUrl(manualSourceId.value, manualUrl.value.trim())
    const ref = catalog.register({
      sourceId: detail.sourceId,
      sourceName: detail.sourceName,
      sourceType: detail.sourceType,
      bookUrl: detail.bookUrl,
      name: detail.name,
      author: detail.author,
      coverUrl: detail.coverUrl,
      tocUrl: detail.tocUrl,
    })
    router.push(bookRoute(ref))
  }
  catch (e) {
    manualError.value = e instanceof Error ? e.message : '添加失败'
  }
  finally {
    manualLoading.value = false
  }
}

function openBook(book: SearchBook) {
  const ref = catalog.registerFromSearch(book)
  router.push(bookRoute(ref))
}

function addToShelf(book: SearchBook) {
  catalog.registerFromSearch(book)
  bookshelf.add({
    sourceId: book.sourceId,
    sourceName: book.sourceName,
    sourceType: book.sourceType,
    name: book.name,
    author: book.author,
    coverUrl: book.coverUrl,
    bookUrl: book.bookUrl,
  })
}

function typeLabel(sourceType: number) {
  return sourceType === 2 ? '漫画' : '小说'
}
</script>

<template>
  <section class="panel">
    <div class="search-bar">
      <input
        v-model="keyword"
        placeholder="搜索小说或漫画，也可直接粘贴书籍详情页 URL"
        @keyup.enter="search"
      >
      <select v-model="type">
        <option value="all">全部</option>
        <option value="0">小说</option>
        <option value="2">漫画</option>
      </select>
      <button :disabled="loading" @click="search">
        {{ loading ? '搜索中...' : '搜索' }}
      </button>
    </div>

    <div class="manual-add">
      <h3 style="margin: 16px 0 8px; font-size: 1rem;">手动添加书籍</h3>
      <p class="meta">粘贴书籍详情页地址（如 69书吧：https://www.69shuba.com/book/89878.htm）</p>
      <div class="search-bar" style="margin-top: 8px;">
        <select v-model="manualSourceId" class="manual-source">
          <option v-for="source in sources" :key="source.id" :value="source.id">
            {{ source.name }}
          </option>
        </select>
        <input
          v-model="manualUrl"
          placeholder="https://www.69shuba.com/book/89878.htm"
          @keyup.enter="openByManualUrl"
        >
        <button :disabled="manualLoading || !manualUrl.trim()" @click="openByManualUrl">
          {{ manualLoading ? '加载中...' : '打开' }}
        </button>
      </div>
      <p v-if="manualError" class="meta" style="color: #f87171; margin-top: 8px;">{{ manualError }}</p>

      <div v-if="needsCookieJar" class="cookie-panel">
        <h4 style="margin: 16px 0 8px; font-size: 0.95rem;">Cloudflare 站点（69书吧等）</h4>
        <p class="meta">
          浏览器复制的 Cookie 无法在服务端直接使用（Cloudflare 校验 TLS 指纹）。
          请启动 <strong>FlareSolverr</strong> 并在启动 server 前设置：
        </p>
        <pre class="cookie-code">export FLARESOLVERR_URL=http://127.0.0.1:8191
export NO_PROXY=localhost,127.0.0.1</pre>
        <p class="meta">
          Docker 启动：<code>docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest</code>
        </p>
        <p class="meta">
          可选：下方粘贴 Cookie 供 FlareSolverr 复用（非必须）。
          站点：<a :href="selectedManualSource?.url" target="_blank" rel="noopener">{{ selectedManualSource?.url }}</a>
        </p>
        <textarea
          v-model="cookieText"
          class="cookie-input"
          rows="3"
          placeholder="cf_clearance=...; __cf_bm=..."
        />
        <div class="cookie-actions">
          <button :disabled="cookieSaving" @click="saveSourceCookies">
            {{ cookieSaving ? '保存中...' : '保存 Cookie' }}
          </button>
          <span v-if="cookieConfigured" class="meta cookie-status">已配置</span>
          <span v-if="cookieMessage" class="meta">{{ cookieMessage }}</span>
        </div>
      </div>
    </div>

    <p v-if="error" class="meta">{{ error }}</p>
    <p v-else-if="results.length" class="meta">共 {{ results.length }} 条结果</p>

    <div v-if="results.length" class="grid">
      <article v-for="book in results" :key="`${book.sourceId}-${book.bookUrl}`" class="card">
        <div class="card-cover" @click="openBook(book)">
          <img v-if="book.coverUrl" :src="proxyImage(book.coverUrl)" :alt="book.name">
          <span v-else>{{ book.name.slice(0, 1) }}</span>
        </div>
        <div class="card-body">
          <div class="card-title">{{ book.name }}</div>
          <div class="meta">
            <span class="badge">{{ typeLabel(book.sourceType) }}</span>
            {{ book.sourceName }}
          </div>
          <div v-if="book.author" class="meta">作者：{{ book.author }}</div>
          <div v-if="book.lastChapter" class="meta">最新：{{ book.lastChapter }}</div>
          <div class="actions">
            <button class="primary" @click="openBook(book)">详情</button>
            <button @click="addToShelf(book)">
              {{ bookshelf.has(book.sourceId, book.bookUrl) ? '已在书架' : '加书架' }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else-if="!loading" class="empty">
      输入关键词搜索，或在上方手动粘贴书籍详情页 URL 打开。
    </div>
  </section>
</template>

<style scoped>
.manual-add {
  margin-top: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #2a3140);
}

.manual-source {
  min-width: 140px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a3140);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
}

.cookie-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border, #2a3140);
}

.cookie-input {
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a3140);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  resize: vertical;
}

.cookie-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.cookie-status {
  color: #4ade80;
}

.cookie-code {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  overflow-x: auto;
  white-space: pre;
}
</style>
