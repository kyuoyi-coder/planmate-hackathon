"use client";

import { BorderBeam } from "border-beam";
import { useResolvedTheme } from "@/lib/theme";
import { AlertTriangle, CalendarCheck } from "lucide-react";
import type { Proposal } from "@/lib/planner/types";
import { dateOf, formatDuration, fromNaive } from "@/lib/time";

export type PlanStatus = "draft" | "confirmed" | "superseded" | "discarded";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const STATUS_NOTE: Record<Exclude<PlanStatus, "confirmed">, string> = {
  superseded: "Replaced on your calendar by the updated plan below",
  discarded: "Taken off your calendar",
  // Plans from before they were added straight away, never confirmed.
  draft: "Not added to your calendar",
};

/**
 * A plan the assistant has put on the calendar. To change it, or take it
 * off again, the user tells the assistant.
 */
export default function PlanCard({
  proposal,
  status,
}: {
  proposal: Proposal;
  status: PlanStatus;
}) {
  const theme = useResolvedTheme();
  const isLive = status === "confirmed";
  const blocksByDate = new Map<string, Proposal["blocks"]>();
  for (const block of proposal.blocks) {
    const date = dateOf(block.start);
    blocksByDate.set(date, [...(blocksByDate.get(date) ?? []), block]);
  }
  // Days in the planning range, plus any day a personal block landed on.
  const dates = [
    ...new Set([
      ...proposal.days.map((day) => day.date),
      ...blocksByDate.keys(),
    ]),
  ].sort();
  const dayInfo = new Map(proposal.days.map((day) => [day.date, day]));

  return (
    // The beam marks the plan that is on the calendar now. It switches off
    // once the plan is replaced or undone.
    <BorderBeam
      className="w-full min-w-0"
      colorVariant="forest"
      theme={theme}
      strength={0.8}
      borderRadius={16}
      active={isLive}
    >
    <section
      aria-label="Plan"
      className={`w-full min-w-0 space-y-3 rounded-2xl border bg-card p-3 text-sm text-navy ${
        isLive ? "border-primary/30" : "opacity-70"
      }`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="flex items-center gap-1.5 font-heading text-lg font-medium">
          {isLive && <CalendarCheck aria-hidden="true" className="size-4 text-primary" />}
          {isLive ? "On your calendar" : "Plan"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatDuration(proposal.totalMinutes)} total · max{" "}
          {formatDuration(proposal.dailyLimitMinutes)}/day
        </span>
      </header>

      <ol className="space-y-2.5">
        {dates.map((date) => {
          const blocks = blocksByDate.get(date) ?? [];
          const info = dayInfo.get(date);
          const planned = info?.plannedMinutes ?? 0;
          const existing = info?.existingMinutes ?? 0;
          const percent = Math.min(
            100,
            Math.round(((planned + existing) / proposal.dailyLimitMinutes) * 100),
          );
          const over = planned + existing > proposal.dailyLimitMinutes;

          return (
            <li key={date} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold">
                  {dayFormat.format(fromNaive(date))}
                </span>
                <span className="text-muted-foreground">
                  {planned ? formatDuration(planned) : "Free"}
                  {existing ? ` + ${formatDuration(existing)} already booked` : ""}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full ${over ? "bg-clay" : "bg-primary"}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {blocks.length > 0 && (
                <ul className="space-y-0.5 pt-0.5">
                  {blocks.map((block) => (
                    <li
                      key={`${block.start}-${block.title}`}
                      className="flex gap-2 text-xs leading-snug"
                    >
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {block.start.slice(11)}–{block.end.slice(11)}
                      </span>
                      <span className="min-w-0 break-words">{block.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {proposal.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-clay/15 p-2 text-xs text-warn">
          {proposal.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {isLive ? (
        <footer>
          <p className="text-[11px] text-muted-foreground">
            Want changes? Just tell me, e.g. &ldquo;max 4 hours a day&rdquo;,
            &ldquo;move it to next week&rdquo; or &ldquo;undo the plan&rdquo;.
          </p>
        </footer>
      ) : (
        <p className="text-xs font-medium text-muted-foreground">
          {STATUS_NOTE[status]}
        </p>
      )}
    </section>
    </BorderBeam>
  );
}
