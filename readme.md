# Cartoon

小说/漫画阅读器：Legado 书源规则 + PostgreSQL 书架 + TanStack Start 全栈。

## 快速开始

### 1. 数据库（OrbStack / Docker）

```bash
docker compose up -d
cp .env.example .env
```

### 2. 安装依赖与迁移

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
```

### 3. 启动

```bash
pnpm dev
```

浏览器打开 http://127.0.0.1:3000

- **书架** `/`：已添加的小说（ID 形如 `genwohua:4854`）
- **添加** `/config`：搜索、手动添加书籍
- **书源** `/sources`：书源列表、编辑、禁用；`/sources/new` 新增书源（ID/名称唯一，配置存数据库）

### 书源

书源配置保存在 PostgreSQL。首次可用 `pnpm db:seed` 从 [`remote/*.json`](remote/) 导入；之后在 Web「书源」页管理，无需再改 JSON 文件。

### 代理（可选）

```bash
export HTTP_PROXY=http://127.0.0.1:10808
export HTTPS_PROXY=http://127.0.0.1:10808
# 直连：export CARTOON_PROXY=direct
```

### 缓存

- 目录、书籍元数据：PostgreSQL
- 章节正文：`cache/content/{bookshelfId}/{chapterId}.json`
- 封面：`cache/covers/`
- 漫画图片：`cache/comics/`

可选迁移旧缓存：`pnpm exec tsx scripts/migrate-cache.ts`
