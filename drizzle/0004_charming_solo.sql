ALTER TABLE "chat_messages" ADD COLUMN "email" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "email_status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cannot_finish_reason" text;