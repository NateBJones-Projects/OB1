"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RestrictedToggle } from "@/components/RestrictedToggle";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ active: boolean }>;
  isActive?: (pathname: string) => boolean;
  /** Optional count pill rendered at the trailing edge of the entry. */
  badge?: number;
}

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/thoughts", label: "Thoughts", icon: ThoughtsIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/audit", label: "Audit", icon: AuditIcon },
  { href: "/duplicates", label: "Duplicates", icon: DuplicatesIcon },
  { href: "/ingest", label: "Add", icon: AddIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar({
  restrictedConfigured = false,
  crmEnabled = false,
  wikiEnabled = false,
  openProposals = 0,
}: {
  restrictedConfigured?: boolean;
  crmEnabled?: boolean;
  wikiEnabled?: boolean;
  openProposals?: number;
}) {
  const pathname = usePathname();

  // Hide sidebar on login page
  if (pathname === "/login") return null;

  // CRM and Wiki are optional backends. Default behavior is to ALWAYS show
  // their nav entries — a user who's never applied the schema should still
  // discover the surface exists and be taught how to turn it on (see
  // components/SetupState.tsx). Set NEXT_PUBLIC_OPTIONAL_NAV=auto to restore
  // the old hide-until-enabled behavior, gated on the login-time probe cached
  // in the session. NEXT_PUBLIC_* vars are inlined at build time, so this
  // branch is fixed for the life of a given build/deploy.
  const autoHide = process.env.NEXT_PUBLIC_OPTIONAL_NAV === "auto";
  const showCrm = !autoHide || crmEnabled;
  const showWiki = !autoHide || wikiEnabled;

  // Insert after "Thoughts" so it reads Dashboard → Thoughts → Contacts →
  // Proposals → Wiki → …. The open-proposals badge only ever reflects a real
  // count, so it stays gated on crmEnabled regardless of autoHide.
  const items: NavItem[] = [
    ...nav.slice(0, 2),
    ...(showCrm
      ? [
          { href: "/contacts", label: "Contacts", icon: ContactsIcon },
          { href: "/proposals", label: "Proposals", icon: ProposalsIcon, badge: crmEnabled ? openProposals : undefined },
        ]
      : []),
    ...(showWiki ? [{ href: "/wiki", label: "Wiki", icon: WikiIcon }] : []),
    ...nav.slice(2),
  ];

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-bg-surface border-r border-border flex flex-col z-40">
      <div className="px-5 py-6 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet flex items-center justify-center">
            <span className="text-white text-sm font-bold">O</span>
          </div>
          <span className="text-text-primary font-semibold text-lg tracking-tight">
            Open Brain
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((entry) => {
          const { href, label, icon: Icon, isActive: isActiveFn, badge } = entry;
          const active = isActiveFn
            ? isActiveFn(pathname)
            : href === "/"
              ? pathname === "/"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-surface text-violet border border-violet/20"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              <Icon active={active} />
              {label}
              {badge !== undefined && badge > 0 && (
                <span className="ml-auto text-xs font-semibold px-1.5 py-0.5 rounded-full bg-violet text-white min-w-[1.25rem] text-center">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border space-y-2">
        {restrictedConfigured && <RestrictedToggle />}
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

function AddIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ContactsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <circle cx="6.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 15c0-2.5 2-4 4.5-4S11 12.5 11 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 4.5a2.5 2.5 0 0 1 0 5M13.5 15c0-2.2-1.2-3.6-3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProposalsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <path d="M2 5.5h14v9H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 5.5L9 10l7-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function WikiIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={active ? "text-violet" : "text-text-muted"}>
      <path d="M9 4.5c-1.2-1-3-1.5-5-1.5v10c2 0 3.8.5 5 1.5V4.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 4.5c1.2-1 3-1.5 5-1.5v10c-2 0-3.8.5-5 1.5V4.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
