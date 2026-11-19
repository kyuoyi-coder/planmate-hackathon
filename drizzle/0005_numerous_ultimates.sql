ALTER TABLE "blocks" ADD COLUMN "series_id" text;--> statement-breakpoint
CREATE INDEX "blocks_series_idx" ON "blocks" USING btree ("series_id");