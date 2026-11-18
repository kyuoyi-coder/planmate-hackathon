"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { Wordmark } from "./brand";
import ThemeToggle from "./theme-toggle";
import {
  CalendarDays,
  ChartColumn,
  ListCheckIcon,
  UserPlus,
  Users,
} from "lucide-react";

// The current page is a lit lime pill.
const navItemClassName =
  "rounded-full px-3 text-foreground/80 hover:bg-foreground/5! hover:text-foreground! data-active:bg-primary! data-active:text-primary-foreground! data-active:font-medium";

/**
 * A Client Component only because the active link depends on the current
 * path. The account area is rendered on the server and passed in as `footer`.
 */
export default function AppSidebar({
  footer,
  sharedTaskBadge,
}: {
  footer: React.ReactNode;
  /** The unfinished shared-task count, rendered on the server. */
  sharedTaskBadge?: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActivePage = (href: string) =>
    href === "/"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar>
      {/* header */}
      <SidebarHeader className="bg-transparent px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <Wordmark />
            <span className="mt-1 block text-xs leading-tight text-muted-foreground">
              Plan together, get things done
            </span>
          </div>
        </div>
      </SidebarHeader>

      {/* content */}
      <SidebarContent className="flex-1 overflow-y-auto space-y-5 bg-transparent">
        <SidebarGroup className="border-t">
          <SidebarGroupLabel>Personal Space</SidebarGroupLabel>
          <SidebarGroupContent className="ml-2">
            <SidebarMenu className="space-y-2.5  text-navy">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActivePage("/")}
                  className={navItemClassName}
                  render={<Link href="/" />}
                >
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/tasks"}
                  className={navItemClassName}
                  render={<Link href="/tasks" />}
                >
                  <ListCheckIcon className="h-4 w-4" />
                  Planning
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActivePage("/reports")}
                  className={navItemClassName}
                  render={<Link href="/reports" />}
                >
                  <ChartColumn className="h-4 w-4" />
                  Reports
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="border-t">
          <SidebarGroupLabel>Shared Space</SidebarGroupLabel>
          <SidebarGroupContent className="ml-2">
            <SidebarMenu className="space-y-2.5  text-navy">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActivePage("/tasks/shared")}
                  className={navItemClassName}
                  render={<Link href="/tasks/shared" />}
                >
                  <Users className="h-4 w-4" />
                  Shared Tasks
                </SidebarMenuButton>
                {sharedTaskBadge}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActivePage("/members")}
                  className={navItemClassName}
                  render={<Link href="/members" />}
                >
                  <UserPlus className="h-4 w-4" />
                  Members
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* footer */}
      <SidebarFooter className="gap-2 bg-transparent">
        <ThemeToggle className="mx-2" />
        {footer}
      </SidebarFooter>
    </Sidebar>
  );
}
