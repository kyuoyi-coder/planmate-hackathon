"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useResolvedTheme } from "@/lib/theme";

/** shadcn's Sonner toaster, following PlanMate's own light/dark switch. */
export function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
