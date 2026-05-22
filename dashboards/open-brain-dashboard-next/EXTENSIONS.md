# Dashboard Extensions

The Open Brain dashboard supports drop-in extensions that add a new route
and a sidebar entry **without modifying any core dashboard file**.

## Anatomy

An extension is:

1. A folder under `app/<route>/` containing one or more `page.tsx` files
   (Next.js App Router conventions apply). The folder name becomes the URL.
2. One entry in `extensions.config.ts` adding a sidebar nav item.

That's it. Extensions own their own API helpers (live in the extension
folder, not `lib/api.ts`) and their own types.

## Minimal example

```
app/
  hello/
    page.tsx          ← extension page
    api.ts            ← extension's own data layer (optional)
```

```ts
// extensions.config.ts
export const EXTENSIONS: ExtensionNavEntry[] = [
  { href: "/hello", label: "Hello", icon: "sparkles" },
];
```

`page.tsx` imports its own helpers from `./api` (or wherever), and the
extension is live after `npm run build && vercel deploy --prod`.

## Auth

Extension pages use the same session helpers as core pages:

```tsx
import { requireSessionOrRedirect } from "@/lib/auth";

export default async function Page() {
  const { apiKey } = await requireSessionOrRedirect();
  // ...
}
```

`apiKey` is the OB1 access key the user logged in with — pass it as the
`x-brain-key` header when calling Edge Functions.

## Backend routes

Extensions that need their own REST endpoints have two clean options:

- **Sidecar Edge Function.** Deploy a separate function (e.g.
  `my-extension-api`). Derive its URL on the dashboard side by string-
  replacing `open-brain-rest` in `NEXT_PUBLIC_API_URL` (`agent-memory-api`
  does this — see `lib/agent-memory.ts`).
- **Add routes to `open-brain-rest`.** Acceptable when the data lives in a
  table that's tightly coupled to OB1's core surface area.

## Icon registry

Extensions reference icons by string name because `extensions.config.ts`
is plain TypeScript (no JSX). Supported keys are declared in
`extensions.config.ts` as `ExtensionIcon`. To add a new icon:

1. Add the key to the `ExtensionIcon` union.
2. Implement the SVG component in `components/Sidebar.tsx`.
3. Map the key in `EXTENSION_ICONS`.

## Position in the sidebar

Extensions render in declaration order, between the core nav items
(Dashboard, Thoughts, Workflow, Agent Memory, Search, Audit, Duplicates)
and the trailing "Add" entry.

## Versioning

The extension contract is small (one config file, one folder layout
convention) so it's intentionally not versioned. Breaking changes — if
ever — would surface as TypeScript errors in `extensions.config.ts`,
which is the right place to catch them.
