import { Suspense } from "react";
import { MembersTableSkeleton } from "@/components/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMembers } from "@/lib/data";
import { ROLE_LABEL, type Role } from "@/lib/roles";

const ROLE_STYLES: Record<Role, string> = {
  leader: "bg-primary text-primary-foreground",
  "sub-leader": "bg-ice/20 text-ice",
  member: "bg-foreground/10 text-foreground/80",
};

export default function MembersPage() {
  return (
    <main className="mx-auto my-auto w-full max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--lime)]" />
          Team
        </p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight text-navy">
          Your team members
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Everyone in this PlanMate workspace and their role. Team leaders can
          assign tasks to anyone and sub-leaders to members, by asking
          PlanMate AI.
        </p>
      </header>

      <Suspense fallback={<MembersTableSkeleton />}>
        <MembersTable />
      </Suspense>
    </main>
  );
}

/** Rendered entirely on the server: the table has nothing interactive. */
async function MembersTable() {
  const members = await getMembers();

  return (
    <section
      aria-label="Team member list"
      className="sheet overflow-hidden rounded-xl border bg-card"
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="w-[35%]">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium text-navy">
                {member.name}
                {member.isYou && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (you)
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {member.email}
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_STYLES[member.role]}`}
                >
                  {ROLE_LABEL[member.role]}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
