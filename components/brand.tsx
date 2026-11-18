"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { useResolvedTheme } from "@/lib/theme";

/** PlanMate's lime per theme, for the canvas-drawn orb (which can't read CSS variables). */
const INK = { dark: "#c4f26a", light: "#4d7c0f" };

/**
 * The assistant's "face": a dotted orb from libraries.dev (thinking-orbs).
 * It breathes while idle and changes motion while the assistant is working.
 */
export function AssistantOrb({
  state = "breathing",
  size = 32,
}: {
  state?: OrbState;
  size?: 20 | 32 | 64;
}) {
  const theme = useResolvedTheme();
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme={theme}
      color={INK[theme]}
      aria-hidden="true"
      className="shrink-0"
    />
  );
}

/** The wordmark, with a 3×3 dot glyph that picks up the same motif. */
export function Wordmark({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-heading font-semibold tracking-tight text-navy ${className}`}>
      <span aria-hidden="true" className="grid grid-cols-3 gap-[3px]">
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className={`size-[4px] rounded-full ${[2, 4, 6].includes(index) ? "bg-primary" : "bg-navy/25"}`}
          />
        ))}
      </span>
      PlanMate
    </span>
  );
}
