import { cn } from "@/lib/utils";
import {
  CATEGORY_COLORS,
  CATEGORY_TEXT_COLORS,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_TEXT,
} from "@/lib/constants";

interface CategoryBadgeProps {
  category: string | null;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const key = category?.toLowerCase() ?? "";
  const bg = CATEGORY_COLORS[key] ?? DEFAULT_CATEGORY_COLOR;
  const text = CATEGORY_TEXT_COLORS[key] ?? DEFAULT_CATEGORY_TEXT;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        bg,
        text,
        "bg-opacity-15"
      )}
    >
      {category ?? "other"}
    </span>
  );
}
