import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { getOpenSharedTaskCount } from "@/lib/data";

/**
 * How many tasks teammates assigned the user are still unfinished, next to
 * "Shared Tasks" in the sidebar. It turns ember when one is due by tomorrow.
 */
export default async function SharedTaskBadge() {
  const { open, dueSoon } = await getOpenSharedTaskCount();
  if (open === 0) return null;

  const label = `${open} unfinished shared ${open === 1 ? "task" : "tasks"}${
    dueSoon ? `, ${dueSoon} due by tomorrow` : ""
  }`;
  return (
    <SidebarMenuBadge
      aria-label={label}
      title={label}
      className={
        dueSoon
          ? "rounded-full bg-clay text-clay-foreground!"
          : "rounded-full bg-foreground/10 text-foreground/80"
      }
    >
      {open}
    </SidebarMenuBadge>
  );
}
