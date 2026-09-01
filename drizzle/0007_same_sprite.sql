CREATE TABLE "game_coach_summary" (
	"game_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"summary" text,
	"model" text,
	"error" text,
	"generated_at" timestamp with time zone,
	CONSTRAINT "game_coach_summary_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_coach_summary" ADD CONSTRAINT "game_coach_summary_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_coach_summary" ADD CONSTRAINT "game_coach_summary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_coach_summary_game_idx" ON "game_coach_summary" USING btree ("game_id");