import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarShell } from "@/components/SidebarShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Brain",
  description: "Second brain dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="ob1-graphite-bg min-h-screen flex bg-bg-primary text-text-primary">
        <SidebarShell />
        <main className="flex-1 md:ml-56 min-h-screen pt-12 md:pt-0">
          <div className="mx-auto max-w-7xl px-4 py-4 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
