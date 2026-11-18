"use client";

import MonthAgenda from "@/components/shadcn-big-calendar/month-agenda";
import ShadcnBigCalendar from "@/components/shadcn-big-calendar/shadcn-big-calendar";
import moment from "moment";
import {
  ComponentType,
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { Check } from "lucide-react";
import { moveBlock, toggleBlock } from "@/app/actions";
import type { BlockDto } from "@/lib/data";
import type { ActionResult } from "@/lib/errors";
import type { Category } from "@/lib/planner/types";
import { fromNaive, toNaive } from "@/lib/time";
import type { CalendarProps, EventProps, View } from "react-big-calendar";
import { momentLocalizer, Views } from "react-big-calendar";
import type { EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";

const DnDCalendar = withDragAndDrop<CalendarEvent>(
  ShadcnBigCalendar as ComponentType<CalendarProps<CalendarEvent>>,
);
const localizer = momentLocalizer(moment);
const views = { month: true, week: true, day: true, agenda: MonthAgenda };
// Open the week and day views at the start of the working day, not midnight.
const WORKDAY_START = new Date(1970, 0, 1, 8);

type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  variant: "primary" | "secondary" | "outline";
  completed: boolean;
  /** Priority of the task this session belongs to, if any. */
  priority: BlockDto["priority"];
};

/** A change shown immediately, before the server has confirmed it. */
type Change =
  | { type: "move"; id: string; start: string; end: string }
  | { type: "toggle"; id: string; completed: boolean };

function applyChange(blocks: BlockDto[], change: Change) {
  return blocks.map((block) => {
    if (block.id !== change.id) return block;
    return change.type === "move"
      ? { ...block, start: change.start, end: change.end }
      : { ...block, completed: change.completed };
  });
}

const variantOf = (category: Category): CalendarEvent["variant"] =>
  category === "work"
    ? "primary"
    : category === "study"
      ? "secondary"
      : "outline";

const ToggleCompletedContext = createContext<
  (id: string, completed: boolean) => void
>(() => {});

/** A calendar block: a tick box to mark the session done, then its title. */
function EventCard({ event }: EventProps<CalendarEvent>) {
  const toggleCompleted = useContext(ToggleCompletedContext);
  // Keep the click from selecting or dragging the block underneath.
  const stop = (interaction: React.SyntheticEvent) =>
    interaction.stopPropagation();

  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={event.completed}
        aria-label={`Mark "${event.title}" as ${event.completed ? "not done" : "done"}`}
        title={event.completed ? "Mark as not done" : "Mark as done"}
        className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-current bg-transparent"
        onMouseDown={stop}
        onTouchStart={stop}
        onClick={(click) => {
          click.stopPropagation();
          toggleCompleted(event.id, !event.completed);
        }}
      >
        {event.completed && (
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
        )}
      </button>
      <span className={`min-w-0 ${event.completed ? "line-through" : ""}`}>
        {event.title}
      </span>
    </span>
  );
}

const components = { event: EventCard, agenda: { event: EventCard } };

const eventPropGetter: CalendarProps<CalendarEvent>["eventPropGetter"] = (
  event,
) => ({
  className: [
    `event-variant-${event.variant}`,
    event.priority === "critical" && "event-urgent",
    event.priority === "high" && "event-high",
    event.completed && "event-completed",
  ]
    .filter(Boolean)
    .join(" "),
});

/**
 * The interactive calendar. The blocks come from the server as a prop; this
 * component only adds what needs the browser: dragging, resizing and ticking. Each change shows at once (useOptimistic) while a Server Action
 * saves it and refreshes the server data.
 */
export default function DragDropCalendar({ blocks }: { blocks: BlockDto[] }) {
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState(() => new Date());
  const [error, setError] = useState<string>();
  const [optimisticBlocks, applyOptimistic] = useOptimistic(
    blocks,
    applyChange,
  );
  const [, startTransition] = useTransition();

  const events = useMemo<CalendarEvent[]>(
    () =>
      optimisticBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        start: fromNaive(block.start),
        end: fromNaive(block.end),
        variant: variantOf(block.category),
        completed: block.completed,
        priority: block.priority,
      })),
    [optimisticBlocks],
  );

  // If the save fails, the optimistic change is dropped when the transition
  // ends and the calendar shows the server's data again.
  const save = (
    change: Change,
    action: () => Promise<ActionResult<unknown>>,
  ) => {
    startTransition(async () => {
      applyOptimistic(change);
      const result = await action();
      setError(result.ok ? undefined : result.error);
    });
  };

  const handleMove = ({
    event,
    start,
    end,
    isAllDay,
  }: EventInteractionArgs<CalendarEvent>) => {
    if (isAllDay) return; // Planned blocks always have a time.
    const range = {
      start: toNaive(new Date(start)),
      end: toNaive(new Date(end)),
    };
    if (range.start >= range.end) return;
    save({ type: "move", id: event.id, ...range }, () =>
      moveBlock({ id: event.id, ...range }),
    );
  };

  const toggleCompleted = (id: string, completed: boolean) =>
    save({ type: "toggle", id, completed }, () => toggleBlock(id, completed));

  // Switching tabs always lands on today's month, week or day, wherever the
  // previous view had been navigated to.
  const handleViewChange = (newView: View) => {
    setView(newView);
    setDate(new Date());
  };

  return (
    <section className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {blocks.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
          Your calendar is empty. Tell PlanMate AI on the right what you need to
          get done, and it will fill it in for you.
        </p>
      )}
      <ToggleCompletedContext value={toggleCompleted}>
        <DnDCalendar
          localizer={localizer}
          style={{ height: 700, width: "100%" }}
          className="sheet overflow-hidden rounded-2xl border border-border"
          views={views}
          scrollToTime={WORKDAY_START}
          date={date}
          onNavigate={setDate}
          view={view}
          onView={handleViewChange}
          resizable
          draggableAccessor={() => true}
          resizableAccessor={() => true}
          events={events}
          eventPropGetter={eventPropGetter}
          onEventDrop={handleMove}
          onEventResize={handleMove}
          components={components}
        />
      </ToggleCompletedContext>
    </section>
  );
}
