import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// Display face for headings and the wordmark: a wide, characterful grotesque.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

// Text face for everything else.
const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PlanMate",
  description:
    "Tell PlanMate what's on your plate and get a balanced plan you can actually keep.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme class on <html> is set by THEME_SCRIPT before the first paint,
    // so React must accept the attribute it finds there.
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-svh w-full overflow-hidden">{children}</body>
    </html>
  );
}
