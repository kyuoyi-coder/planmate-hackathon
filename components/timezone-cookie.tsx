"use client";

import { useEffect } from "react";

/**
 * Remembers the browser's timezone in a cookie, so Server Components can work
 * out "today" on the user's clock (see getToday in lib/data.ts). Renders nothing.
 */
export default function TimezoneCookie({ name }: { name: string }) {
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `${name}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;
  }, [name]);

  return null;
}
