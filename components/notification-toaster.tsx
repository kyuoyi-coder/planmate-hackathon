"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { pullNotifications } from "@/app/actions";
import { Toaster } from "@/components/ui/sonner";
import { toNaive } from "@/lib/time";

/** How often to look for new notices while the app is open. */
const POLL_MS = 30_000;

const NOTICE_STYLE = {
  "due-tomorrow": {
    title: "Due tomorrow",
    icon: <BellRing className="size-4 text-clay" />,
  },
  "task-completed": {
    title: "Task completed",
    icon: <CircleCheck className="size-4 text-primary" />,
  },
  "cannot-finish": {
    title: "Can't finish on time",
    icon: <AlertTriangle className="size-4 text-clay" />,
  },
} as const;

/**
 * Shows deadline reminders, "task completed" and "can't finish on time"
 * notices as toasts. It asks the server when the app opens, every half
 * minute, and when the tab comes back into view. Each notice arrives once,
 * so a toast stays until closed. The same check keeps the Shared Tasks count
 * in the sidebar current when a teammate assigns something new.
 */
export default function NotificationToaster() {
  const router = useRouter();
  const sharedCount = useRef<string | undefined>(undefined);

  useEffect(() => {
    let inFlight = false;

    const check = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await pullNotifications(toNaive(new Date()).slice(0, 10));
        // Shown even if this component has just unmounted: the notice was
        // already marked as delivered, and the toaster itself is global.
        if (!result.ok) return;
        const { notices, shared } = result.data;
        for (const notice of notices) {
          const style = NOTICE_STYLE[notice.kind];
          toast(style.title, {
            id: notice.id,
            description: notice.message,
            icon: style.icon,
            duration: Infinity,
            closeButton: true,
            action: {
              label: "View",
              onClick: () => router.push("/tasks/shared"),
            },
          });
        }
        // A teammate's update changes the "Assigned by you" board, and a new
        // or finished shared task changes the sidebar count: re-render.
        const count = `${shared.open}/${shared.dueSoon}`;
        const countChanged =
          sharedCount.current !== undefined && sharedCount.current !== count;
        sharedCount.current = count;
        if (countChanged || notices.some((notice) => notice.kind !== "due-tomorrow")) {
          router.refresh();
        }
      } catch {
        // Offline or the server restarted: try again on the next tick.
      } finally {
        inFlight = false;
      }
    };

    void check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return <Toaster position="top-center" visibleToasts={5} />;
}
