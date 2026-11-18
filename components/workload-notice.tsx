"use client";

import { useState } from "react";
import { BorderBeam } from "border-beam";
import { AlertTriangle, CalendarClock, UserRoundCheck } from "lucide-react";
import { useResolvedTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  AssignmentStatus,
  HeldAssignment,
  HeldDecision,
} from "@/lib/planner/types";
import { formatDuration, fromNaive, toNaive } from "@/lib/time";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
});
const longDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const STATUS_NOTE: Record<Exclude<AssignmentStatus, "pending">, string> = {
  assigned: "Assigned anyway",
  cancelled: "Not assigned",
  superseded: "Changed: see below",
};

/**
 * The burnout check's warning in the chat. While the decision is open it
 * offers a button to (re)open the popup with the options.
 */
export default function WorkloadNotice({
  held,
  status,
  onReview,
}: {
  held: HeldAssignment[];
  status: AssignmentStatus;
  onReview: () => void;
}) {
  const theme = useResolvedTheme();
  const isPending = status === "pending";

  return (
    <BorderBeam
      className="w-full min-w-0"
      colorVariant="sunset"
      theme={theme}
      strength={0.8}
      borderRadius={16}
      active={isPending}
    >
      <section
        aria-label="Workload check"
        className={`w-full min-w-0 space-y-2 rounded-2xl border bg-card p-3 text-sm text-navy ${
          isPending ? "border-clay/40" : "opacity-70"
        }`}
      >
        {held.map(({ assigneeName, title, workload }) => (
          <p key={`${assigneeName}-${title}`} className="flex gap-2">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-clay" />
            <span>
              <span className="font-medium">{assigneeName}</span> is at{" "}
              {Math.round((workload.plannedMinutes / workload.capacityMinutes) * 100)}%
              of capacity · &ldquo;{title}&rdquo;
            </span>
          </p>
        ))}
        {isPending ? (
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={onReview}>
            Review options
          </Button>
        ) : (
          <p className="text-xs font-medium text-muted-foreground">{STATUS_NOTE[status]}</p>
        )}
      </section>
    </BorderBeam>
  );
}

/**
 * The popup a leader or sub-leader sees when the person they are assigning
 * to looks overloaded. It explains why and offers every way forward: give it
 * to someone with more room, move the deadline, assign anyway, or don't.
 * The agent only advises; the assigner decides.
 */
export function WorkloadDialog({
  open,
  onOpenChange,
  held,
  busy,
  onDecide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  held: HeldAssignment[];
  busy: boolean;
  onDecide: (decision: HeldDecision) => void;
}) {
  const names = [...new Set(held.map((item) => item.assigneeName))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0 text-clay" />
            {names.join(" and ")} {names.length === 1 ? "looks" : "look"} overloaded
          </DialogTitle>
          <DialogDescription>
            Nothing has been assigned yet. This is a suggestion to help your
            team avoid burnout; the decision is yours.
          </DialogDescription>
        </DialogHeader>

        {held.map((item, index) => (
          <HeldItem
            key={`${item.assigneeId}-${item.title}`}
            item={item}
            busy={busy}
            onReassign={(assigneeId) => onDecide({ action: "reassign", index, assigneeId })}
            onReschedule={(dueDate) => onDecide({ action: "reschedule", index, dueDate })}
          />
        ))}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide({ action: "cancel" })}
          >
            Don&apos;t assign
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => onDecide({ action: "confirm" })}
          >
            Assign anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HeldItem({
  item,
  busy,
  onReassign,
  onReschedule,
}: {
  item: HeldAssignment;
  busy: boolean;
  onReassign: (assigneeId: string) => void;
  onReschedule: (dueDate: string) => void;
}) {
  const { workload } = item;
  const first = item.assigneeName.split(" ")[0];
  const today = toNaive(new Date()).slice(0, 10);
  const [customDate, setCustomDate] = useState("");
  const alternatives = workload.alternatives.filter(
    (person): person is typeof person & { id: string } => Boolean(person.id),
  );

  return (
    <section className="space-y-4 rounded-xl border bg-card/60 p-4">
      <div className="space-y-1">
        <h3 className="font-medium text-navy">
          &ldquo;{item.title}&rdquo; for {item.assigneeName}, due{" "}
          {longDayFormat.format(fromNaive(item.dueDate))}
        </h3>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {workload.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
          {workload.unscheduledTasks > 0 && (
            <li>
              {workload.unscheduledTasks} of their tasks in that period{" "}
              {workload.unscheduledTasks === 1 ? "isn't" : "aren't"} on their
              calendar yet, so the real load is higher
            </li>
          )}
        </ul>
      </div>

      <LoadChart item={item} />

      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <UserRoundCheck aria-hidden="true" className="size-3.5" />
          Change the handler
        </h4>
        {alternatives.length ? (
          <div className="flex flex-wrap gap-2">
            {alternatives.map((person) => (
              <Button
                key={person.id}
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onReassign(person.id)}
              >
                Give to {person.name}
                <span className="text-muted-foreground">
                  · {person.plannedMinutes ? `${formatDuration(person.plannedMinutes)} planned` : "free"}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No one you can assign to has much more room in this period.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-3.5" />
          Reschedule for {first}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          {workload.laterDay && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onReschedule(workload.laterDay!.date)}
            >
              Due {longDayFormat.format(fromNaive(workload.laterDay.date))}
              <span className="text-muted-foreground">
                · {workload.laterDay.minutes ? `${formatDuration(workload.laterDay.minutes)} planned` : "free day"}
              </span>
            </Button>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (customDate) onReschedule(customDate);
            }}
          >
            <Input
              type="date"
              aria-label={`New due date for "${item.title}"`}
              min={today}
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
              className="h-8 w-40"
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !customDate}>
              Move
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

/** The assignee's planned work per day against their daily limit. */
function LoadChart({ item }: { item: HeldAssignment }) {
  const { workload, assigneeName } = item;
  // Scale the bars to the busiest day, but never below the limit.
  const scale = Math.max(workload.limitMinutes, ...workload.days.map((day) => day.minutes));
  const share = Math.round((workload.plannedMinutes / workload.capacityMinutes) * 100);

  return (
    <figure className="space-y-1.5">
      <figcaption className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{assigneeName}&apos;s planned work per day</span>
        <span>
          {formatDuration(workload.plannedMinutes)} planned · {share}% of capacity
        </span>
      </figcaption>
      <ol aria-label={`${assigneeName}'s planned work per day`} className="flex h-20 items-end gap-1">
        {workload.days.slice(0, 14).map((day) => {
          const over = day.minutes > workload.limitMinutes;
          return (
            <li
              key={day.date}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              title={`${dayFormat.format(fromNaive(day.date))}: ${day.minutes ? formatDuration(day.minutes) : "nothing"} planned`}
            >
              <div className="relative flex w-full flex-1 items-end rounded-sm bg-foreground/5">
                {/* The daily limit. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-dashed border-foreground/30"
                  style={{ bottom: `${(workload.limitMinutes / scale) * 100}%` }}
                />
                <span
                  className={`w-full rounded-sm ${over ? "bg-clay" : "bg-primary/80"}`}
                  style={{ height: `${(day.minutes / scale) * 100}%` }}
                />
              </div>
              <span className="truncate text-[10px] text-muted-foreground">
                {dayFormat.format(fromNaive(day.date))}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        Dashed line: their {formatDuration(workload.limitMinutes)} daily limit.
      </p>
    </figure>
  );
}
