import { Suspense } from "react";
import AppSidebar from "@/components/app-sidebar";
import Aurora from "@/components/ui/aurora";
import ChatRoom from "@/components/chat-room";
import NotificationToaster from "@/components/notification-toaster";
import SharedTaskBadge from "@/components/shared-task-badge";
import SidebarUser from "@/components/sidebar-user";
import { ChatPanelSkeleton, SidebarUserSkeleton } from "@/components/skeletons";
import TimezoneCookie from "@/components/timezone-cookie";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";
import { getChatSessions, TIMEZONE_COOKIE } from "@/lib/data";
import { canAssign } from "@/lib/roles";

/**
 * The app shell. The frame is static; the two parts that depend on who is
 * signed in (the account in the sidebar and the chat history) load on the
 * server behind their own Suspense boundaries, so the page shows immediately
 * and those fill in.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // The aurora (21st.dev) drifts behind everything; the sidebar and chat are
    // frosted glass on top of it.
    <Aurora
      className="h-full"
      colors={["var(--lime)", "var(--ice)", "#a78bfa"]}
      intensity={0.13}
      duration={26}
    >
    <SidebarProvider className="h-full min-h-0 overflow-hidden">
      <TimezoneCookie name={TIMEZONE_COOKIE} />
      <NotificationToaster />
      <AppSidebar
        footer={
          <Suspense fallback={<SidebarUserSkeleton />}>
            <SidebarUser />
          </Suspense>
        }
        sharedTaskBadge={
          <Suspense fallback={null}>
            <SharedTaskBadge />
          </Suspense>
        }
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <SidebarTrigger className="shrink-0" />
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <section className="dot-grid min-h-0 min-w-0 flex-3 overflow-y-auto py-12">
            {children}
          </section>
          <div className="glass sticky top-0 h-full min-h-0 min-w-0 flex-1 overflow-hidden border-l">
            <Suspense fallback={<ChatPanelSkeleton />}>
              <ChatPanel />
            </Suspense>
          </div>
        </div>
      </main>
    </SidebarProvider>
    </Aurora>
  );
}

/**
 * Loads the chat list and hands it to the client. Every visit (opening the
 * site, or signing in) starts on a fresh chat; earlier conversations stay in
 * the history list. Moving between pages keeps the chat that is open, because
 * the layout is not re-rendered from scratch on navigation.
 */
async function ChatPanel() {
  const user = await requireUser();
  const sessions = await getChatSessions();

  return <ChatRoom initialSessions={sessions} canAssign={canAssign(user.role)} />;
}
