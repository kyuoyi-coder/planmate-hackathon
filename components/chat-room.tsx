"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  decideEmail,
  deleteChat,
  openChat,
  resolveAssignment,
  sendChatMessage,
} from "@/app/actions";
import { AssistantOrb } from "@/components/brand";
import PlanCard from "@/components/plan-card";
import {
  ChatMessagesSkeleton,
  ChatReplySkeleton,
} from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import WorkloadNotice, { WorkloadDialog } from "@/components/workload-notice";
import EmailNotice, { EmailDialog } from "@/components/email-review";
import PromptComposer, {
  type ComposerPlatform,
} from "@/components/ui/prompt-composer";
import type { ChatMessageDto, ChatSessionDto } from "@/lib/data";
import type { HeldDecision } from "@/lib/planner/types";
import { toNaive } from "@/lib/time";

type ChatMessage = ChatMessageDto & { isError?: boolean };

// What the composer's placeholder types out, one after another.
const EXAMPLE_PROMPTS = [
  "This week I have 2 assignments to complete, 3 papers to review, and I want to study ML...",
  "Next week I have 1 urgent report to write and 1 presentation to prepare...",
  "I finished paper 2...",
  "Max 4 hours a day and keep Sunday free...",
];

// Chips that drop a starter sentence into the composer.
const STARTERS: ComposerPlatform[] = [
  { label: "Plan my week", icon: "spark", starter: "This week I have " },
  { label: "Update a task", icon: "bolt", starter: "I finished " },
];
const ASSIGN_STARTER: ComposerPlatform = {
  label: "Assign",
  icon: "chat",
  starter: "Assign ",
};

/** A message with neither a plan card nor a workload notice. */
const NO_CARDS = {
  plan: null,
  planStatus: null,
  assignments: null,
  assignmentStatus: null,
  email: null,
  emailStatus: null,
};

const errorMessage = (content: string): ChatMessage => ({
  id: `error-${Date.now()}`,
  role: "assistant",
  content,
  ...NO_CARDS,
  isError: true,
});

/**
 * The chat panel. It opens on a new chat, with the saved chat list from the
 * server as a prop; from then on it is a live conversation,
 * so it keeps its own state and talks to the server through Server Actions.
 */
export default function ChatRoom({
  initialSessions,
  canAssign,
}: {
  /** Only team leaders and sub-leaders are offered the "Assign" starter. */
  canAssign: boolean;
  initialSessions: ChatSessionDto[];
}) {
  const [sessions, setSessions] = useState(initialSessions);
  // null = a new chat that has not been saved yet. Each visit starts here.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSessionListOpen, setIsSessionListOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [resolvingId, setResolvingId] = useState<string>();
  // The held assignment whose workload popup is open.
  const [reviewId, setReviewId] = useState<string>();
  // The drafted message whose review popup is open.
  const [emailReviewId, setEmailReviewId] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, isThinking, isLoadingSession]);

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setIsSessionListOpen(false);
  };

  const openSession = async (id: string) => {
    setActiveSessionId(id);
    setIsSessionListOpen(false);
    setMessages([]);
    setIsLoadingSession(true);
    const result = await openChat(id);
    setMessages(result.ok ? result.data : [errorMessage(result.error)]);
    setIsLoadingSession(false);
  };

  const deleteSession = async (session: ChatSessionDto) => {
    const confirmed = window.confirm(
      `Delete the chat "${session.title}"? Plans you already confirmed stay on your calendar.`,
    );
    if (!confirmed) return;

    const result = await deleteChat(session.id);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setSessions((current) => current.filter(({ id }) => id !== session.id));
    if (session.id === activeSessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isThinking) return;

    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: pendingId, role: "user", content, ...NO_CARDS },
    ]);
    setIsThinking(true);

    const result = await sendChatMessage({
      sessionId: activeSessionId ?? undefined,
      content,
      now: toNaive(new Date()),
    });
    setIsThinking(false);

    if (!result.ok) {
      setMessages((current) => [...current, errorMessage(result.error)]);
      return;
    }

    const { session, messages: added, settled } = result.data;
    const [userMessage, reply] = added;

    // The server says what this turn did to a plan or assignment that was
    // waiting for a decision; update the card that is showing it.
    setMessages((current) => [
      ...current
        .filter((message) => message.id !== pendingId)
        .map((message) => ({
          ...message,
          planStatus:
            message.id === settled.planMessageId && settled.plan
              ? settled.plan
              : message.planStatus,
          assignmentStatus:
            message.assignmentStatus === "pending" && settled.assignment
              ? settled.assignment
              : message.assignmentStatus,
          emailStatus:
            message.emailStatus === "pending" && settled.email
              ? settled.email
              : message.emailStatus,
        })),
      userMessage,
      reply,
    ]);
    // An overload warning opens as a popup straight away.
    if (reply.assignmentStatus === "pending") setReviewId(reply.id);
    // So does a drafted message, for the user to review before it is sent.
    if (reply.emailStatus === "pending") setEmailReviewId(reply.id);
    setActiveSessionId(session.id);
    setSessions((current) => [
      { id: session.id, title: session.title, preview: reply.content },
      ...current.filter(({ id }) => id !== session.id),
    ]);
  };

  const handleDecision = async (messageId: string, decision: HeldDecision) => {
    setResolvingId(messageId);
    const result = await resolveAssignment(
      messageId,
      decision,
      toNaive(new Date()).slice(0, 10),
    );
    setResolvingId(undefined);

    if (!result.ok) {
      setReviewId(undefined);
      setMessages((current) => [...current, errorMessage(result.error)]);
      return;
    }
    const reply = result.data.message;
    setMessages((current) => [
      ...current.map((message) =>
        message.id === messageId
          ? { ...message, assignmentStatus: result.data.assignmentStatus }
          : message,
      ),
      reply,
    ]);
    // The new choice can be overloaded too: then its own warning opens.
    setReviewId(reply.assignmentStatus === "pending" ? reply.id : undefined);
  };

  const handleEmail = async (
    messageId: string,
    decision: { action: "send"; subject: string; body: string } | { action: "cancel" },
  ) => {
    setResolvingId(messageId);
    const result = await decideEmail(messageId, decision);
    setResolvingId(undefined);
    setEmailReviewId(undefined);

    if (!result.ok) {
      setMessages((current) => [...current, errorMessage(result.error)]);
      return;
    }
    setMessages((current) => [
      ...current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              emailStatus: result.data.emailStatus,
              // Keep the text as sent, edits included, for "Open in email app".
              email:
                decision.action === "send" && message.email
                  ? { ...message.email, subject: decision.subject, body: decision.body }
                  : message.email,
            }
          : message,
      ),
      result.data.message,
    ]);
  };

  const reviewingEmail = messages.find(
    (message) =>
      message.id === emailReviewId && message.emailStatus === "pending" && message.email,
  );

  const reviewing = messages.find(
    (message) =>
      message.id === reviewId &&
      message.assignmentStatus === "pending" &&
      message.assignments,
  );

  return (
    <aside className="sticky top-0 flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        {/* The assistant's face: calm while idle, busy while it works. */}
        <AssistantOrb state={isThinking ? "working" : "breathing"} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate font-heading text-xl font-medium text-navy">
              PlanMate AI
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                isSessionListOpen ? "Hide chat sessions" : "Show chat sessions"
              }
              aria-expanded={isSessionListOpen}
              onClick={() => setIsSessionListOpen((open) => !open)}
            >
              {isSessionListOpen ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isThinking ? "Working on it…" : "Your planning assistant"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Start a new chat"
          onClick={startNewChat}
        >
          <Plus />
        </Button>
      </header>

      {isSessionListOpen ? (
        <section
          aria-label="Chat sessions"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        >
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent chats
          </h3>
          {sessions.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">
              No chats yet. Send a message to start one.
            </p>
          )}
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;

            return (
              <div
                key={session.id}
                className={`flex items-center gap-1 rounded-lg transition-colors ${
                  isActive
                    ? "border bg-foreground/10 text-navy"
                    : "hover:bg-foreground/5"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={isActive}
                  className="min-w-0 flex-1 p-3 text-left"
                  onClick={() => void openSession(session.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {session.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {session.preview}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mr-1 shrink-0 text-muted-foreground hover:text-red-700"
                  aria-label={`Delete chat: ${session.title}`}
                  onClick={() => void deleteSession(session)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </section>
      ) : (
        <>
          <div
            ref={logRef}
            aria-label="Chat messages"
            aria-live="polite"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4"
            role="log"
          >
            {isLoadingSession && <ChatMessagesSkeleton />}

            {messages.length === 0 && !isThinking && !isLoadingSession && (
              <div className="sheet space-y-3 rounded-2xl border bg-card/80 p-4 text-sm text-navy">
                <p className="font-heading text-lg font-medium leading-snug">
                  What&apos;s on your plate?
                </p>
                <p>
                  Tell me what you need to get done and by when. I&apos;ll
                  put a balanced schedule on your calendar, and you can tell
                  me to change it any time.
                </p>
                <p className="text-xs text-muted-foreground">
                  Pick a starter below, or just type.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex w-full min-w-0 flex-col gap-1 ${
                  message.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <span className="text-[11px] font-medium text-muted-foreground">
                  {message.role === "user" ? "You" : "PlanMate AI"}
                </span>
                {message.content && (
                  <p
                    role={message.isError ? "alert" : undefined}
                    className={`min-w-0 max-w-[95%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm ${
                      message.isError
                        ? "bg-destructive/15 text-danger"
                        : message.role === "user"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm border bg-card/80 text-navy"
                    }`}
                  >
                    {message.content}
                  </p>
                )}
                {message.plan && message.planStatus && (
                  <PlanCard
                    proposal={message.plan}
                    status={message.planStatus}
                  />
                )}
                {message.email && message.emailStatus && (
                  <EmailNotice
                    email={message.email}
                    status={message.emailStatus}
                    onReview={() => setEmailReviewId(message.id)}
                  />
                )}
                {message.assignments && message.assignmentStatus && (
                  <WorkloadNotice
                    held={message.assignments}
                    status={message.assignmentStatus}
                    onReview={() => setReviewId(message.id)}
                  />
                )}
              </div>
            ))}

            {isThinking && (
              <div className="flex w-full items-start gap-2">
                <AssistantOrb state="composing" size={20} />
                <ChatReplySkeleton />
              </div>
            )}
          </div>

          {/* The prompt box is a 21st.dev component (components/ui/prompt-composer). */}
          <div className="border-t p-3">
            <PromptComposer
              accent="lime"
              prompts={EXAMPLE_PROMPTS}
              placeholder="What do you need to get done?"
              platforms={canAssign ? [...STARTERS, ASSIGN_STARTER] : STARTERS}
              showModels={false}
              attachments={false}
              simulate={false}
              hint={false}
              busy={isThinking}
              label="Message PlanMate AI"
              sendLabel="Send message"
              onSubmit={({ prompt }) => void send(prompt)}
            />
          </div>
        </>
      )}
      {reviewingEmail?.email && (
        <EmailDialog
          // A fresh form for each draft.
          key={reviewingEmail.id}
          open
          onOpenChange={(open) => {
            if (!open) setEmailReviewId(undefined);
          }}
          email={reviewingEmail.email}
          busy={resolvingId === reviewingEmail.id}
          onSend={(edited) => void handleEmail(reviewingEmail.id, { action: "send", ...edited })}
          onCancel={() => void handleEmail(reviewingEmail.id, { action: "cancel" })}
        />
      )}
      {reviewing?.assignments && (
        <WorkloadDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewId(undefined);
          }}
          held={reviewing.assignments}
          busy={resolvingId === reviewing.id}
          onDecide={(decision) => void handleDecision(reviewing.id, decision)}
        />
      )}
    </aside>
  );
}
