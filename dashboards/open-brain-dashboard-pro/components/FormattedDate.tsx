"use client";

import { formatDate } from "@/lib/format";

/**
 * Renders a date string formatted as MM/DD/YYYY HH:MM in the user's local timezone.
 * Use this in server components to ensure consistent client-side timezone rendering.
 */
export function FormattedDate({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  return <span className={className}>{formatDate(date)}</span>;
}
