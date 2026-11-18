import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholders shown while a Server Component is still loading its data.
 * Each one mirrors the layout of what replaces it, so the page doesn't jump.
 */

export function CalendarSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading calendar"
      className="space-y-3 rounded-2xl border bg-card p-3"
      style={{ height: 750 }}
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid h-[calc(100%-2.75rem)] grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, column) => (
          <div key={column} className="flex flex-col gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="w-full flex-1 opacity-40" />
            <Skeleton
              className="w-full"
              style={{ height: `${18 + ((column * 7) % 5) * 6}%` }}
            />
            <Skeleton className="w-full flex-1 opacity-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskBoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tasks" className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        {[3, 2, 1].map((cards, column) => (
          <div key={column} className="space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            {Array.from({ length: cards }, (_, card) => (
              <div key={card} className="space-y-3 rounded-xl border p-4">
                <div className="flex justify-between gap-3">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <div className="flex justify-between pt-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MembersTableSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading members"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <div className="bg-muted/50 px-4 py-3">
        <Skeleton className="h-4 w-1/3" />
      </div>
      {Array.from({ length: 8 }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-t px-4 py-3">
          <Skeleton className="h-4 w-[30%]" />
          <Skeleton className="h-4 w-[35%]" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report" className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, card) => (
          <Skeleton key={card} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/** Chat bubbles, alternating sides like a conversation. */
export function ChatMessagesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading messages" className="flex flex-col gap-4">
      <Skeleton className="h-9 w-3/5 self-end rounded-2xl bg-foreground/10" />
      <Skeleton className="h-20 w-11/12 rounded-2xl bg-foreground/10" />
      <Skeleton className="h-44 w-full rounded-2xl bg-foreground/10" />
      <Skeleton className="h-9 w-2/5 self-end rounded-2xl bg-foreground/10" />
      <Skeleton className="h-14 w-4/5 rounded-2xl bg-foreground/10" />
    </div>
  );
}

/** The assistant's reply while it is being worked out. */
export function ChatReplySkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="PlanMate AI is working on a reply"
      className="w-4/5 space-y-2 self-start rounded-2xl rounded-bl-sm border bg-card px-3 py-3"
    >
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function ChatPanelSkeleton() {
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-32 bg-foreground/10" />
          <Skeleton className="h-3 w-20 bg-foreground/10" />
        </div>
        <Skeleton className="size-8 bg-foreground/10" />
      </header>
      <div className="min-h-0 flex-1 p-4">
        <ChatMessagesSkeleton />
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-9 w-full bg-foreground/10" />
      </div>
    </aside>
  );
}

export function SidebarUserSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading account" className="flex items-center gap-2 p-2">
      <Skeleton className="size-8 shrink-0 rounded-full bg-foreground/10" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-24 bg-foreground/10" />
        <Skeleton className="h-3 w-16 bg-foreground/10" />
      </div>
    </div>
  );
}
