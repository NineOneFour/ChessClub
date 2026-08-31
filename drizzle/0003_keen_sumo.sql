CREATE TABLE "game_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_id" integer NOT NULL,
	"initial_ms" integer NOT NULL,
	"increment_ms" integer NOT NULL,
	"color" text DEFAULT 'random' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"game_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_offers" ADD CONSTRAINT "game_offers_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_offers" ADD CONSTRAINT "game_offers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_offers_status_idx" ON "game_offers" USING btree ("status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_offers_open_from_key" ON "game_offers" USING btree ("from_id") WHERE status = 'open';