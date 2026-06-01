import { createRouter, createWebHistory } from 'vue-router'
import BookshelfPage from '../pages/BookshelfPage.vue'
import BookDetailPage from '../pages/BookDetailPage.vue'
import ReaderPage from '../pages/ReaderPage.vue'
import SearchPage from '../pages/SearchPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'search', component: SearchPage },
    { path: '/bookshelf', name: 'bookshelf', component: BookshelfPage },
    { path: '/book', name: 'book', component: BookDetailPage },
    { path: '/read', name: 'read', component: ReaderPage },
  ],
})

export default router
