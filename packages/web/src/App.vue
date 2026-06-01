<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">Cartoon</div>
      <nav class="nav">
        <RouterLink to="/">搜索</RouterLink>
        <RouterLink to="/bookshelf">书架</RouterLink>
      </nav>
    </header>
    <RouterView />
  </div>
</template>
