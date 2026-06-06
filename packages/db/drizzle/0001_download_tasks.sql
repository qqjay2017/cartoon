CREATE TABLE IF NOT EXISTS "download_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"bookshelf_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"chapter_name" text NOT NULL,
	"chapter_url" text NOT NULL,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "download_tasks" ADD CONSTRAINT "download_tasks_bookshelf_id_bookshelf_id_fk" FOREIGN KEY ("bookshelf_id") REFERENCES "public"."bookshelf"("id") ON DELETE cascade ON UPDATE no action;
