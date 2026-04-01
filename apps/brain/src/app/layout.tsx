import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/contexts/AuthContext'
import { Nav } from '@/components/Nav'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'BigOleBrain',
  description: 'Household dashboard',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        <AuthProvider>
          <Nav />
          <main className="px-4 py-4">{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}
