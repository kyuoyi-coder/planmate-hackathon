import { Suspense } from "react";
import ReportDashboard from "@/components/report-dashboard";
import { ReportSkeleton } from "@/components/skeletons";
import { getReport } from "@/lib/data";

export default function ReportPage() {
  return (
    <main className="mx-auto my-auto w-full max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--lime)]" />
          Reports
        </p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight text-navy">
          Your work-life balance
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Understand how you spend your time, how your workload is progressing,
          and whether your work boundaries are holding up week to week.
        </p>
      </header>

      <Suspense fallback={<ReportSkeleton />}>
        <Report />
      </Suspense>
    </main>
  );
}

/** Computes the figures on the server; the dashboard only switches period and draws the chart. */
async function Report() {
  return <ReportDashboard data={await getReport()} />;
}
