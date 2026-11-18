import { Suspense } from "react";
import { Check } from "lucide-react";
import DragDropCalendar from "@/components/drag-drop-calendar";
import { CalendarSkeleton } from "@/components/skeletons";
import { getBlocks } from "@/lib/data";

const LEGEND = [
  { label: "Work", className: "bg-primary" },
  { label: "Study", className: "bg-ice" },
  { label: "Urgent", className: "bg-clay" },
  { label: "High priority", className: "border border-clay bg-clay/25" },
];

export default function CalendarPage() {
  return (
    <main className="mx-auto my-auto w-full max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--lime)]" />
          Calendar
        </p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight text-navy">
          Your calendar for managing tasks
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Plan your day, organize tasks, and keep track of upcoming events in
          one place. Ask PlanMate AI to plan your week, then drag or resize
          blocks to adjust your schedule. Tick a block when you&apos;ve done it.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {LEGEND.map(({ label, className }) => (
            <li key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2.5 rounded-sm ${className}`} />
              {label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <Check aria-hidden="true" className="size-3" />
            Done (faded)
          </li>
        </ul>
      </header>

      <Suspense fallback={<CalendarSkeleton />}>
        <Calendar />
      </Suspense>
    </main>
  );
}

/** Reads the blocks on the server and hands them to the interactive calendar. */
async function Calendar() {
  return <DragDropCalendar blocks={await getBlocks()} />;
}
