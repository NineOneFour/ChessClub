CREATE TABLE "challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_id" integer NOT NULL,
	"to_id" integer NOT NULL,
	"initial_ms" integer NOT NULL,
	"increment_ms" integer NOT NULL,
	"color" text DEFAULT 'random' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"game_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_moves" (
	"game_id" integer NOT NULL,
	"ply" integer NOT NULL,
	"uci" text NOT NULL,
	"san" text NOT NULL,
	"fen_after" text NOT NULL,
	"white_ms" integer NOT NULL,
	"black_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_moves_game_id_ply_pk" PRIMARY KEY("game_id","ply")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"white_id" integer NOT NULL,
	"black_id" integer NOT NULL,
	"initial_ms" integer NOT NULL,
	"increment_ms" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"result" text,
	"result_reason" text,
	"winner_id" integer,
	"fen" text NOT NULL,
	"ply" integer DEFAULT 0 NOT NULL,
	"white_ms" integer NOT NULL,
	"black_ms" integer NOT NULL,
	"clock_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draw_offer_by" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_white_id_users_id_fk" FOREIGN KEY ("white_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_black_id_users_id_fk" FOREIGN KEY ("black_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_draw_offer_by_users_id_fk" FOREIGN KEY ("draw_offer_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenges_to_status_idx" ON "challenges" USING btree ("to_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_open_pair_key" ON "challenges" USING btree ("from_id","to_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "games_white_idx" ON "games" USING btree ("white_id");--> statement-breakpoint
CREATE INDEX "games_black_idx" ON "games" USING btree ("black_id");