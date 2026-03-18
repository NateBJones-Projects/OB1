import { cn } from "@/lib/utils";
import { PRIORITY_COLORS } from "@/lib/constants";

interface PriorityDotProps {
  priority: string;
}

export function PriorityDot({ priority }: PriorityDotProps) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        PRIORITY_COLORS[priority] ?? "bg-text-muted",
        priority === "urgent" && "animate-pulse"
      )}
    />
  );
}
