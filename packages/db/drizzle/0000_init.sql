CREATE TABLE IF NOT EXISTS "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"file_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookshelf" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"book_id" text NOT NULL,
	"book_url" text NOT NULL,
	"name" text NOT NULL,
	"author" text,
	"cover_url" text,
	"last_read_chapter_id" text,
	"last_read_chapter_name" text,
	"added_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_meta" (
	"bookshelf_id" text PRIMARY KEY NOT NULL,
	"detail" jsonb NOT NULL,
	"toc_cached_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"bookshelf_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"chapter_url" text NOT NULL,
	"name" text NOT NULL,
	"sort_index" integer NOT NULL,
	"update_time" text,
	CONSTRAINT "chapters_bookshelf_id_chapter_id_pk" PRIMARY KEY("bookshelf_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapter_content" (
	"bookshelf_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"file_path" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_content_bookshelf_id_chapter_id_pk" PRIMARY KEY("bookshelf_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_cookies" (
	"source_id" text PRIMARY KEY NOT NULL,
	"cookies" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookshelf" ADD CONSTRAINT "bookshelf_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "book_meta" ADD CONSTRAINT "book_meta_bookshelf_id_bookshelf_id_fk" FOREIGN KEY ("bookshelf_id") REFERENCES "public"."bookshelf"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_bookshelf_id_bookshelf_id_fk" FOREIGN KEY ("bookshelf_id") REFERENCES "public"."bookshelf"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chapter_content" ADD CONSTRAINT "chapter_content_bookshelf_id_bookshelf_id_fk" FOREIGN KEY ("bookshelf_id") REFERENCES "public"."bookshelf"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_cookies" ADD CONSTRAINT "source_cookies_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
