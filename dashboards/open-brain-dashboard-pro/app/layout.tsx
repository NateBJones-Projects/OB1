import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

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
  description: "Open Brain second-brain dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Codex-P2-4: server-only check — only expose the restricted toggle to the
  // client when the passphrase hash is configured. Passing as a boolean avoids
  // leaking the hash itself into the client bundle.
  const restrictedConfigured = Boolean(
    process.env.RESTRICTED_PASSPHRASE_HASH &&
      process.env.RESTRICTED_PASSPHRASE_HASH.length > 0
  );

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-bg-primary text-text-primary">
        <Sidebar restrictedConfigured={restrictedConfigured} />
        <main className="flex-1 ml-56 min-h-screen">
          <div className="max-w-6xl mx-auto px-8 py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
