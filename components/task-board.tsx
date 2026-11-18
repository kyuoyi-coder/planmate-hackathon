"use client";

import { useId, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import TaskCard, { type TaskCardProps, type TaskStatus } from "./task-card";

type Task = Omit<TaskCardProps, "status"> & { id: string };

export type TaskGroup = {
  status: TaskStatus;
  title: string;
  tasks: Task[];
};

export default function TaskBoard({ groups }: { groups: TaskGroup[] }) {
  // Unique per board: a page can show more than one.
  const id = useId();
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const selectedDateValue = selectedDate
    ? format(selectedDate, "yyyy-MM-dd")
    : "";
  const taskDates = groups
    .flatMap((group) => group.tasks.map((task) => task.dueDate))
    .sort();
  const dateRangeNote = selectedDate
    ? `Showing tasks due ${format(selectedDate, "MMM d, yyyy")}.`
    : taskDates.length === 0
      ? "No task dates available."
      : taskDates[0] === taskDates[taskDates.length - 1]
        ? `Tasks due ${format(parseISO(taskDates[0]), "MMM d, yyyy")}.`
        : `Task date range: ${format(parseISO(taskDates[0]), "MMM d, yyyy")} – ${format(parseISO(taskDates[taskDates.length - 1]), "MMM d, yyyy")}`;
  const filteredGroups = groups.map((group) => ({
    ...group,
    tasks: selectedDateValue
      ? group.tasks.filter((task) => task.dueDate === selectedDateValue)
      : group.tasks,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p aria-live="polite" className="text-sm text-muted-foreground sm:pb-2">
          {dateRangeNote}
        </p>
        <div className="flex items-end justify-end gap-2">
          <div className="grid gap-1.5 text-sm font-medium text-navy">
            <span id={`${id}-date-filter`}>Filter by due date</span>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    aria-labelledby={`${id}-date-filter`}
                    className="w-full justify-start text-left font-normal sm:w-52"
                  />
                }
              >
                <CalendarDays aria-hidden="true" />
                {selectedDate ? format(selectedDate, "PPP") : "Choose a date"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    setSelectedDate(date);
                    if (date) setDatePickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          {selectedDate && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedDate(undefined)}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        {filteredGroups.map(({ status, title, tasks }) => (
          <section
            key={status}
            aria-labelledby={`${id}-${status}`}
            className="space-y-4"
          >
            <header className="flex items-center justify-between gap-3">
              <h2
                id={`${id}-${status}`}
                className="font-heading text-xl font-medium text-navy"
              >
                {title}
              </h2>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              </span>
            </header>

            <div className="space-y-3">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <TaskCard key={task.id} {...task} status={status} />
                ))
              ) : (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  {selectedDateValue
                    ? "No tasks due on this date."
                    : `No ${title.toLowerCase()} tasks.`}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
