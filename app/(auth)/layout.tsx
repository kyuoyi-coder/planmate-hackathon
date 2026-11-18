import { AssistantOrb, Wordmark } from "@/components/brand";
import ThemeToggle from "@/components/theme-toggle";
import Aurora from "@/components/ui/aurora";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Aurora
      className="h-full"
      colors={["var(--lime)", "var(--ice)", "#a78bfa"]}
      intensity={0.2}
      duration={24}
    >
      <ThemeToggle className="absolute top-4 right-4 z-10" />
      <main className="dot-grid flex h-full items-center justify-center overflow-y-auto p-4">
        <div className="glass sheet w-full max-w-sm space-y-6 rounded-3xl border p-8">
          <div className="flex items-center gap-4">
            <AssistantOrb size={64} />
            <div>
              <Wordmark className="text-3xl" />
              <span className="mt-1 block text-sm text-muted-foreground">
                Plan together, get things done
              </span>
            </div>
          </div>
          {children}
        </div>
      </main>
    </Aurora>
  );
}
