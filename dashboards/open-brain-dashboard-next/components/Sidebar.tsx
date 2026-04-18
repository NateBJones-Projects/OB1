"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RestrictedToggle } from "@/components/RestrictedToggle";

const nav = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/thoughts", label: "Thoughts", icon: ThoughtsIcon },
  { href: "/kanban", label: "Workflow", icon: KanbanIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/audit", label: "Audit", icon: AuditIcon },
  { href: "/duplicates", label: "Duplicates", icon: DuplicatesIcon },
  { href: "/ingest", label: "Add", icon: AddIcon },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <aside
      className={`fixed left-0 top-0 h-screen w-56 bg-bg-surface border-r border-border flex flex-col z-50
        hidden md:flex
        ${isOpen ? "!flex" : ""}
      `}
    >
      <div className="px-5 py-6 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5" onClick={onClose}>
          <div className="w-8 h-8 rounded-lg bg-violet flex items-center justify-center">
            <span className="text-white text-sm font-bold">OB</span>
          </div>
          <span className="text-text-primary font-semibold text-lg tracking-tight">
            Open Brain
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-surface text-violet border border-violet/20"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border space-y-2">
        <RestrictedToggle />
        <form action="/api/logout" method="POST">
          <button
            type="submit"
            className="text-sm text-text-muted hover:text-danger transition-colors px-3 py-1"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function DashboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ThoughtsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <path d="M3 4.5h12M3 9h8M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11.5 11.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AuditIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <path d="M9 1.5L2 5v4c0 4.4 3 8.5 7 9.5 4-1 7-5.1 7-9.5V5L9 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function DuplicatesIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <rect x="1" y="3" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="var(--bg-surface)" />
    </svg>
  );
}

function KanbanIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <rect x="1" y="2" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="2" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="2" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AddIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
