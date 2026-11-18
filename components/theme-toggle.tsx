"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemeChoice, useThemeChoice, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Appearance: Light, Dark, or follow the system setting. */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useThemeChoice();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={`flex items-center gap-0.5 rounded-full border bg-background/60 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={label}
            onClick={() => setThemeChoice(value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
