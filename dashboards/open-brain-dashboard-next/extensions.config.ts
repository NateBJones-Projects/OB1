/**
 * Dashboard Extension Registry
 * ============================
 *
 * Drop-in extensions register here. Each entry adds one nav item to the
 * sidebar, in declaration order, between the core nav and the trailing
 * "Add" entry. Extension pages live under `app/<route>/` and may declare
 * their own local helpers — no other dashboard file needs to change.
 *
 * To install an extension:
 *   1. Drop its `app/<route>/` folder into the dashboard
 *   2. Add one entry below
 *   3. `npm run build && vercel deploy --prod`
 *
 * To uninstall, remove both. No other file is touched.
 *
 * See EXTENSIONS.md for the full convention.
 */

export type ExtensionIcon = "clock" | "folder" | "plug" | "sparkles";

export interface ExtensionNavEntry {
  /** Route the extension owns, e.g. "/sessions". */
  href: string;
  /** Sidebar label. */
  label: string;
  /** Icon key resolved against the registry in Sidebar.tsx. */
  icon: ExtensionIcon;
}

export const EXTENSIONS: ExtensionNavEntry[] = [];
