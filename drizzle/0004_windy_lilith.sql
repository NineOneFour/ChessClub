ALTER TABLE "users" ADD COLUMN "game_chat_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_customize" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "play_from_minute" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "play_to_minute" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "board_style" text DEFAULT 'scoresheet' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "piece_set" text DEFAULT 'scoresheet' NOT NULL;