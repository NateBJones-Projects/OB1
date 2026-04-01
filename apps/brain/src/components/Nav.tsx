'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

const SHARED_LINKS = [
  { href: '/', label: 'Morning briefing' },
  { href: '/actions', label: 'Actions' },
  { href: '/household', label: 'Household' },
  { href: '/meals', label: 'Meals' },
]

const OWNER_LINKS = [
  { href: '/agent-feed', label: 'Agent feed' },
  { href: '/thoughts', label: 'Thoughts' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { user, isOwner, signOut } = useAuth()

  if (!user) return null

  function close() {
    setOpen(false)
  }

  return (
    <>
      {/* Header bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-gray-200 bg-white px-4">
        <button
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg"
          aria-label="Open menu"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="ml-3 text-lg font-semibold">BigOleBrain</span>
      </header>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <nav
        className={`fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col bg-white shadow-lg transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <span className="text-lg font-semibold">Menu</span>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto p-2">
          {/* Shared links */}
          {SHARED_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className={`flex h-11 items-center rounded-lg px-3 text-base ${
                pathname === link.href
                  ? 'bg-gray-100 font-semibold'
                  : 'hover:bg-gray-50'
              }`}
            >
              {link.label}
            </Link>
          ))}

          {/* Owner-only links */}
          {isOwner && (
            <>
              <hr className="my-2 border-gray-200" />
              <span className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                Personal
              </span>
              {OWNER_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className={`flex h-11 items-center rounded-lg px-3 text-base ${
                    pathname === link.href
                      ? 'bg-gray-100 font-semibold'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </>
          )}
        </div>

        {/* Bottom section */}
        <div className="border-t border-gray-200 p-2">
          <button
            disabled
            className="flex h-11 w-full items-center rounded-lg px-3 text-base text-gray-400"
          >
            Settings
          </button>
          <button
            onClick={async () => {
              close()
              await signOut()
            }}
            className="flex h-11 w-full items-center rounded-lg px-3 text-base text-red-600 hover:bg-red-50"
          >
            Sign out
          </button>
        </div>
      </nav>
    </>
  )
}
