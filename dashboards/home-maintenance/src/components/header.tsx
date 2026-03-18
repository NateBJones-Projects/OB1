import { Home } from "lucide-react";

export function Header() {
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-secondary px-6 py-3">
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold text-text-primary">
          Home Maintenance
        </h1>
      </div>
      <span className="text-sm text-text-muted">{today}</span>
    </header>
  );
}
