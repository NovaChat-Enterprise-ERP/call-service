CREATE SCHEMA "calls";
--> statement-breakpoint
CREATE TABLE "calls"."meeting_invites" (
	"meeting_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_invites_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "calls"."meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE TABLE "calls"."meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text,
	"host_id" text NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp (6) with time zone,
	"started_at" timestamp (6) with time zone,
	"ended_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "calls"."meeting_invites" ADD CONSTRAINT "meeting_invites_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "calls"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls"."meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "calls"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_invites_user_idx" ON "calls"."meeting_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_meeting_idx" ON "calls"."meeting_participants" USING btree ("meeting_id","user_id");--> statement-breakpoint
CREATE INDEX "meetings_workspace_status_idx" ON "calls"."meetings" USING btree ("workspace_id","status","created_at" DESC NULLS LAST);