import { LogOutIcon } from "lucide-react";
import { logout } from "@/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";

/** The signed-in user and the sign-out button, rendered on the server. */
export default async function SidebarUser() {
  const user = await requireUser();
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-2 p-2">
      <Avatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-navy">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {ROLE_LABEL[user.role]}
        </span>
      </div>
      {/* A form posting to a Server Action: signing out needs no client JavaScript. */}
      <form action={logout}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex size-8 items-center justify-center rounded-md text-navy transition-colors hover:bg-foreground/10"
        >
          <LogOutIcon aria-hidden="true" className="size-4" />
        </button>
      </form>
    </div>
  );
}
