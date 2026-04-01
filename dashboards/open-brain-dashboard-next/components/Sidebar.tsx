"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RestrictedToggle } from "@/components/RestrictedToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

const nav = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/thoughts", label: "Browse", icon: BrowseIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/documents", label: "Documents", icon: DocumentsIcon },
  { href: "/ingest", label: "Capture", icon: CaptureIcon },
  { href: "/audit", label: "Review", icon: ReviewIcon },
  { href: "/duplicates", label: "Duplicates", icon: DuplicatesIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-bg-surface border-r border-border flex flex-col z-40">
      <div className="px-5 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-accent flex items-center justify-center">
            <span className="text-white text-xs font-semibold tracking-tight">AS</span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-primary font-semibold text-sm leading-tight">
              Amicus
            </span>
            <span className="text-text-muted text-[11px] leading-tight">
              Superbrain
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                active
                  ? "bg-accent-surface text-accent border border-accent-border"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border space-y-1">
        <ThemeToggle />
        <RestrictedToggle />
        <form action="/api/logout" method="POST">
          <button
            type="submit"
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-muted hover:text-danger transition-colors rounded-md hover:bg-bg-hover w-full"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-muted">
              <path d="M6 2H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H6M10.5 11.5L14 8l-3.5-3.5M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function BrowseIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M2.5 4h11M2.5 8h7M2.5 12h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DocumentsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M9 1.5H4A1.5 1.5 0 002.5 3v10A1.5 1.5 0 004 14.5h8a1.5 1.5 0 001.5-1.5V6L9 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 1.5V6h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5.5 9h5M5.5 11.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CaptureIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M4.5 8l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DuplicatesIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <rect x="1" y="3" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="var(--color-bg-surface)" />
    </svg>
  );
}
