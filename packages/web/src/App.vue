<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
const isReader = computed(() => route.name === 'read')
</script>

<template>
  <div :class="isReader ? 'reader-shell' : 'app-shell'">
    <header v-if="!isReader" class="topbar">
      <div class="brand">Cartoon</div>
      <nav class="nav">
        <RouterLink to="/">搜索</RouterLink>
        <RouterLink to="/bookshelf">书架</RouterLink>
      </nav>
    </header>
    <RouterView />
  </div>
</template>
