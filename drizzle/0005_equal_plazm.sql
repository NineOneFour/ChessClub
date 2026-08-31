CREATE TABLE "game_analysis" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"engine" text,
	"depth" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_move_analysis" (
	"game_id" integer NOT NULL,
	"ply" integer NOT NULL,
	"eval_before_cp" integer NOT NULL,
	"eval_after_cp" integer NOT NULL,
	"loss_cp" integer NOT NULL,
	"best_uci" text,
	"quality" text NOT NULL,
	"mate_before" integer,
	"mate_after" integer,
	CONSTRAINT "game_move_analysis_game_id_ply_pk" PRIMARY KEY("game_id","ply")
);
--> statement-breakpoint
ALTER TABLE "game_analysis" ADD CONSTRAINT "game_analysis_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_move_analysis" ADD CONSTRAINT "game_move_analysis_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_analysis_status_idx" ON "game_analysis" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "game_move_analysis_game_idx" ON "game_move_analysis" USING btree ("game_id","ply");