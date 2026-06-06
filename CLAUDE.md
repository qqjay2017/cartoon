# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack novel/comic reader app supporting Legado book source rules (Chinese web novel/manga scraper format). Monorepo with pnpm workspaces.

- **Frontend**: React 19, TypeScript, Vite, TanStack Start (file-based routing), React Query, Tailwind CSS 4, shadcn/ui (Radix UI)
- **Backend**: TanStack Start + Hono (server API routes)
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Package manager**: pnpm workspaces

## Commands

```bash
# Dev
pnpm dev                          # Start dev server (port 3000)

# Build
pnpm build                        # Build all packages
pnpm typecheck                    # Type check all packages

# Database
pnpm db:migrate                   # Run migrations
pnpm db:seed                      # Seed initial book sources from remote/*.json

# Tests
pnpm test                         # Run tests (core package only, Vitest)

# Format
pnpm format                       # Prettier (no semicolons, single quotes, trailing commas)

# Setup from scratch
docker compose up -d              # Start PostgreSQL
cp .env.example .env              # Configure DB URL
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Monorepo Structure

```
apps/web/          # TanStack Start full-stack app (frontend + API)
packages/core/     # Book source engine & utilities (standalone)
packages/db/       # PostgreSQL/Drizzle ORM layer
remote/            # JSON book source configs (seeded into DB on first run)
cache/             # Runtime file caches: covers/, content/, comics/
scripts/           # Utility scripts (e.g., migrate-cache.ts)
```

**Package dependency graph**: `web` → `core` + `db`; `db` → `core`; `core` is standalone.

## Architecture

### `@cartoon/core` — Book Source Engine

Implements the Legado rule engine for parsing web content:

- **`engine/book-service.ts`** — Main entry point: search, fetch book metadata, TOC, and chapter content
- **`engine/rule-engine.ts`** — Rule parser supporting XPath, JSON path, and inline JS
- **`engine/js-runtime.ts`** — Executes JavaScript embedded in book source rules
- **`engine/source-session.ts`** — Stateful wrapper maintaining cookies per source
- **`cache/`** — File-based caching: `NovelCacheService` (text), `ComicCacheService` (images)
- **`download/`** — Exporters: EPUB, MOBI, TXT, CBZ, folder
- **`registry/`** — In-memory `SourceRegistry` for enabled sources
- **`loader/`** — Load sources from JSON (`remote/*.json`)

Two source types: `0` = text novels, `2` = comics.

### `@cartoon/db` — Database Layer

Five tables: `sources`, `bookshelf`, `book_meta`, `chapters`, `chapter_content`, `source_cookies`.

Repositories in `src/repositories/`: `sources.ts`, `bookshelf.ts`, `cache.ts`.

### `@cartoon/web` — Full-Stack App

**Routes** (file-based via TanStack Router):
- `/` → Bookshelf (user library)
- `/config` → Add books (search or manual)
- `/sources` → Source management
- `book.$bookshelfId` → Book detail + caching controls
- `read.$bookshelfId.$chapterIndex` → Reader

**API** (`src/server/api.ts`, Hono): Sources CRUD, bookshelf, book metadata/TOC/content, downloads, search, cache prefetch.

**App context** (`src/server/context.ts`): Initializes and shares `BookService`, `SourceRegistry`, cache services across requests.

## Key Patterns

**Book source ID format**: `sourceId:bookId` (e.g., `genwohua:4854`)

**Three-tier caching**:
1. PostgreSQL — metadata (book_meta, chapters)
2. File system — chapter text (`cache/content/{bookshelfId}/{chapterId}.json`), comic images (`cache/comics/`), covers (`cache/covers/`)
3. In-memory — `SourceRegistry` for enabled sources

**Charset handling**: `iconv-lite` for GBK↔UTF-8 conversion on legacy Chinese sites; inferred from URL patterns.

**Legado rule format**: Rules use XPath, JSON path (JSONata-style), or JS expressions for parsing. Book sources stored in PostgreSQL after initial seed from `remote/*.json`.

**Proxy support**: Set `CARTOON_PROXY` in `.env`; use `direct` to bypass proxy.
