import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { getSession } from "@/lib/auth";
import { fetchCrmProposalsCount, ApiError } from "@/lib/api";

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

export default async function RootLayout({
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
  // Feature detection: the CRM sidebar entry only appears when the brain
  // exposed the /crm surface at login (probed and cached in the session).
  const session = await getSession();
  const crmEnabled = session.crmEnabled === true;

  // Open-proposals badge: a best-effort read that never blocks the shell. An
  // older brain without the count route (or any transient error) degrades to no
  // badge rather than failing the layout.
  let openProposals = 0;
  if (crmEnabled && session.apiKey) {
    try {
      const res = await fetchCrmProposalsCount(session.apiKey);
      openProposals = res.open;
    } catch (err) {
      if (err instanceof ApiError) {
        console.error("[layout/proposals-count] upstream", err.status, err.upstreamBody);
      } else {
        console.error("[layout/proposals-count]", err);
      }
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-bg-primary text-text-primary">
        <Sidebar restrictedConfigured={restrictedConfigured} crmEnabled={crmEnabled} openProposals={openProposals} />
        <main className="flex-1 ml-56 min-h-screen">
          <div className="max-w-6xl mx-auto px-8 py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
