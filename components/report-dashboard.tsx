"use client";

import { useState, useSyncExternalStore } from "react";
import { endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type ReportPeriod = "weekly" | "monthly";

export type ReportDataPoint = {
  period: string;
  workHours: number;
  personalHours: number;
  exerciseHours: number;
  restHours: number;
  unscheduledHours: number;
  overtimeHours: number;
  completedTasks: number;
  plannedTasks: number;
  boundaryChecksPassed: number;
  boundaryChecks: number;
  preferredHoursDays: number;
  observedDays: number;
};

export type ReportData = Record<ReportPeriod, ReportDataPoint[]>;

const timeCategories = [
  { key: "workHours", label: "Work & study", color: "bg-chart-1" },
  { key: "personalHours", label: "Personal", color: "bg-chart-2" },
  { key: "exerciseHours", label: "Exercise", color: "bg-chart-3" },
  { key: "restHours", label: "Rest", color: "bg-chart-4" },
  { key: "unscheduledHours", label: "Unscheduled", color: "bg-chart-5" },
] as const;

const chartConfig = {
  workHours: { label: "Work & study", color: "var(--chart-1)" },
  personalHours: { label: "Personal", color: "var(--chart-2)" },
  exerciseHours: { label: "Exercise", color: "var(--chart-3)" },
  restHours: { label: "Rest", color: "var(--chart-4)" },
  unscheduledHours: { label: "Unscheduled", color: "var(--chart-5)" },
} satisfies ChartConfig;

function formatHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatWeekRange(date: Date) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
  const startFormat =
    weekStart.getFullYear() === weekEnd.getFullYear() ? "MMM d" : "MMM d, yyyy";

  return `${format(weekStart, startFormat)} – ${format(weekEnd, "MMM d, yyyy")}`;
}

function subscribeToCurrentDate(callback: () => void) {
  const intervalId = window.setInterval(callback, 60_000);
  return () => window.clearInterval(intervalId);
}

function getCurrentDateSnapshot() {
  return format(new Date(), "yyyy-MM-dd");
}

function getServerDateSnapshot() {
  return null;
}

/**
 * A Client Component for the weekly/monthly switch and the chart. The figures
 * are computed on the server (getReport in lib/data.ts) and passed in.
 */
export default function ReportDashboard({ data }: { data: ReportData }) {
  const [period, setPeriod] = useState<ReportPeriod>("weekly");
  const currentDateSnapshot = useSyncExternalStore(
    subscribeToCurrentDate,
    getCurrentDateSnapshot,
    getServerDateSnapshot,
  );
  const currentDate = currentDateSnapshot
    ? parseISO(currentDateSnapshot)
    : undefined;

  const periodData = data[period];
  const totals = periodData.reduce(
    (result, entry) => ({
      workHours: result.workHours + entry.workHours,
      personalHours: result.personalHours + entry.personalHours,
      exerciseHours: result.exerciseHours + entry.exerciseHours,
      restHours: result.restHours + entry.restHours,
      unscheduledHours: result.unscheduledHours + entry.unscheduledHours,
      overtimeHours: result.overtimeHours + entry.overtimeHours,
      completedTasks: result.completedTasks + entry.completedTasks,
      plannedTasks: result.plannedTasks + entry.plannedTasks,
      boundaryChecksPassed:
        result.boundaryChecksPassed + entry.boundaryChecksPassed,
      boundaryChecks: result.boundaryChecks + entry.boundaryChecks,
      preferredHoursDays: result.preferredHoursDays + entry.preferredHoursDays,
      observedDays: result.observedDays + entry.observedDays,
    }),
    {
      workHours: 0,
      personalHours: 0,
      exerciseHours: 0,
      restHours: 0,
      unscheduledHours: 0,
      overtimeHours: 0,
      completedTasks: 0,
      plannedTasks: 0,
      boundaryChecksPassed: 0,
      boundaryChecks: 0,
      preferredHoursDays: 0,
      observedDays: 0,
    },
  );
  const boundaryPercent = totals.boundaryChecks
    ? Math.round((totals.boundaryChecksPassed / totals.boundaryChecks) * 100)
    : 0;
  const completionPercent = totals.plannedTasks
    ? Math.round((totals.completedTasks / totals.plannedTasks) * 100)
    : 0;
  const isHealthy = boundaryPercent >= 85 && totals.overtimeHours <= 3;
  const periodLabel = currentDate
    ? period === "weekly"
      ? formatWeekRange(currentDate)
      : `Current month: ${format(currentDate, "MMMM yyyy")}`
    : period === "weekly"
      ? "Current week"
      : "Current month";
  const highestOvertimeEntry = periodData.reduce<ReportDataPoint | undefined>(
    (highest, entry) =>
      entry.overtimeHours > (highest?.overtimeHours ?? 0) ? entry : highest,
    undefined,
  );
  const overtimePeriod =
    period === "weekly" && highestOvertimeEntry?.period === "Thu"
      ? "Thursday"
      : highestOvertimeEntry?.period ?? "the reporting period";
  const highestOvertimeHours = highestOvertimeEntry?.overtimeHours ?? 0;
  const overtimeReflection =
    highestOvertimeHours > 0
      ? `${overtimePeriod} exceeded your work boundary by ${formatHours(highestOvertimeHours)}.`
      : "You stayed within your work boundary throughout this period.";

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-heading text-2xl font-medium text-navy">Work-life balance</h2>
          <p className="text-sm text-muted-foreground">
            Review your time, workload, and work boundaries for {periodLabel}.
          </p>
        </div>
        <div
          aria-label="Report period"
          className="flex items-center gap-2"
          role="group"
        >
          <Button
            type="button"
            variant={period === "weekly" ? "default" : "outline"}
            aria-pressed={period === "weekly"}
            onClick={() => setPeriod("weekly")}
          >
            Weekly
          </Button>
          <Button
            type="button"
            variant={period === "monthly" ? "default" : "outline"}
            aria-pressed={period === "monthly"}
            onClick={() => setPeriod("monthly")}
          >
            Monthly
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Time breakdown</CardTitle>
          <CardDescription>{periodLabel}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {timeCategories.map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${color}`}
              />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-navy">
                  {formatHours(totals[key])}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Work boundary respected</CardDescription>
            <CardTitle className="text-3xl text-navy">
              {boundaryPercent}%
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div
              aria-label={`${boundaryPercent}% of work boundary checks respected`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={boundaryPercent}
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${boundaryPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Within your preferred hours on {totals.preferredHoursDays} of{" "}
              {totals.observedDays} days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Overtime</CardDescription>
            <CardTitle className="text-3xl text-navy">
              {formatHours(totals.overtimeHours)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {periodLabel}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Tasks completed</CardDescription>
            <CardTitle className="text-3xl text-navy">
              {totals.completedTasks} / {totals.plannedTasks}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {completionPercent}% of planned tasks
          </CardContent>
        </Card>

        <Card
          className={
            isHealthy
              ? "bg-primary/10 ring-primary/30"
              : "bg-clay/10 ring-clay/35"
          }
        >
          <CardHeader>
            <CardDescription>Workload balance</CardDescription>
            <CardTitle
              className={`flex items-center gap-2 text-2xl ${
                isHealthy ? "text-primary" : "text-clay"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-3 rounded-full ${isHealthy ? "bg-primary" : "bg-clay"}`}
              />
              {isHealthy ? "Healthy" : "Needs attention"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Based on your daily work limit and preferred hours
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {period === "weekly" ? "Weekly reflection" : "Monthly reflection"}
          </CardTitle>
          <CardDescription>
            A quick read on your productivity and balance for {periodLabel}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              You completed {completionPercent}% of your planned work (
              {totals.completedTasks} of {totals.plannedTasks} tasks).
            </li>
            <li>
              Your work stayed within your preferred hours on{" "}
              {totals.preferredHoursDays} of {totals.observedDays} days.
            </li>
            <li>{overtimeReflection}</li>
            <li>
              {isHealthy
                ? "Your schedule leaves room to recover. Keep protecting your evenings."
                : "Ask PlanMate AI to re-plan with a lower daily limit, or drop a low-priority task."}
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time use over the period</CardTitle>
          <CardDescription>
            Hours by {period === "weekly" ? "day" : "week"} for {periodLabel}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChartContainer config={chartConfig} className="h-[340px] w-full">
            <BarChart
              accessibilityLayer
              data={periodData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="period"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                unit="h"
                width={36}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="dashed" />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {timeCategories.map(({ key }) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="time"
                  fill={`var(--color-${key})`}
                  radius={key === "unscheduledHours" ? 4 : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
          <p className="text-xs text-muted-foreground">
            Built from the blocks on your calendar, including planned ones
            later in the period. Unscheduled is free time inside your working
            hours.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
