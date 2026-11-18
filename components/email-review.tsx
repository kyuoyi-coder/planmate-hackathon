"use client";

import { useState } from "react";
import { ExternalLink, Mail, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { mailtoHref } from "@/lib/mailto";
import type { EmailDraft, EmailStatus } from "@/lib/planner/types";

const STATUS_NOTE: Record<Exclude<EmailStatus, "pending">, string> = {
  sent: "Sent in PlanMate",
  cancelled: "Not sent",
  superseded: "Replaced by a newer draft",
};

/** The drafted message in the chat. While unsent it can reopen the review popup. */
export default function EmailNotice({
  email,
  status,
  onReview,
}: {
  email: EmailDraft;
  status: EmailStatus;
  onReview: () => void;
}) {
  const isPending = status === "pending";
  return (
    <section
      aria-label="Message to your leader"
      className={`w-full min-w-0 space-y-2 rounded-2xl border bg-card p-3 text-sm text-navy ${
        isPending ? "border-ice/40" : "opacity-70"
      }`}
    >
      <p className="flex gap-2">
        <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ice" />
        <span className="min-w-0">
          To <span className="font-medium">{email.toName}</span>:{" "}
          <span className="break-words">{email.subject}</span>
        </span>
      </p>
      {isPending ? (
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onReview}>
          Review and send
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{STATUS_NOTE[status]}</p>
          {status === "sent" && (
            // Emailing goes through the user's own email app.
            <a
              href={mailtoHref({ to: email.toEmail, subject: email.subject, body: email.body })}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <ExternalLink aria-hidden="true" />
              Open in email app
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The popup that shows the drafted message before it goes to whoever
 * assigned the task. The user can edit it, then send or cancel; nothing is
 * sent without "Send". Send is a mailto: link: it opens the message in the
 * user's own email app, and tells PlanMate it was sent so the assigner gets
 * a notification.
 */
export function EmailDialog({
  open,
  onOpenChange,
  email,
  busy,
  onSend,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: EmailDraft;
  busy: boolean;
  onSend: (edited: { subject: string; body: string }) => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const empty = !subject.trim() || !body.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail aria-hidden="true" className="size-5 shrink-0 text-ice" />
            Review your message
          </DialogTitle>
          <DialogDescription>
            This goes to {email.toName}, who assigned you &ldquo;{email.taskTitle}&rdquo;.
            Edit anything you like. Send opens it in your email app and lets
            them know in PlanMate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <p className="text-sm text-navy">
              {email.toName} <span className="text-muted-foreground">&lt;{email.toEmail}&gt;</span>
            </p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Subject</span>
            <Input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Message</span>
            <textarea
              value={body}
              maxLength={5000}
              rows={10}
              onChange={(event) => setBody(event.target.value)}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-navy outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          {busy || empty ? (
            <Button type="button" disabled>
              <Send aria-hidden="true" />
              Send
            </Button>
          ) : (
            // A real link, so the browser hands it to the email app on click.
            <a
              href={mailtoHref({ to: email.toEmail, subject: subject.trim(), body: body.trim() })}
              className={buttonVariants()}
              onClick={() => onSend({ subject: subject.trim(), body: body.trim() })}
            >
              <Send aria-hidden="true" />
              Send
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
