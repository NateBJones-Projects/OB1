"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

/**
 * Sanitized markdown renderer for agent-writable wiki bodies.
 *
 * ── XSS boundary (important) ──────────────────────────────────────────────────
 * Wiki section bodies are written by agents over MCP, so they are UNTRUSTED input.
 * This component renders them with `react-markdown` and deliberately installs NO
 * `rehype-raw` (and no other raw-HTML plugin). Without `rehype-raw`, react-markdown
 * does not parse embedded HTML into DOM nodes — a literal `<script>…</script>` or
 * `<img onerror=…>` in the source is emitted as visible text, never executed. That
 * is the whole defense: do not add `rehype-raw`, `dangerouslyAllowHtml`, or
 * `dangerouslySetInnerHTML` here. Autolinked/`[text](url)` links are still rendered
 * as anchors, so they carry `rel="noopener noreferrer nofollow"` and open safely.
 *
 * There is no Tailwind typography plugin in this project, so each element is styled
 * explicitly with the dark-theme tokens from globals.css to get a readable prose
 * column that matches the rest of the dashboard.
 */

const components: Components = {
  p: ({ children }) => (
    <p className="text-text-primary text-sm leading-relaxed my-2 first:mt-0 last:mb-0 break-words">
      {children}
    </p>
  ),
  h1: ({ children }) => (
    <h1 className="text-text-primary text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-text-primary text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-text-primary text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-text-secondary text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-text-secondary text-xs font-semibold uppercase tracking-wider mt-3 mb-1 first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-text-muted text-xs font-semibold uppercase tracking-wider mt-3 mb-1 first:mt-0">
      {children}
    </h6>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-violet hover:text-violet-dim underline underline-offset-2 break-words"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-2 space-y-1 text-text-primary text-sm marker:text-text-muted">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 text-text-primary text-sm marker:text-text-muted">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-violet/30 pl-3 my-2 text-text-secondary italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    // Fenced blocks arrive with a language-* class; inline code has none. Style
    // the two differently but keep both as plain, non-executing text.
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code className={`${className} font-mono text-xs`}>{children}</code>
      );
    }
    return (
      <code className="font-mono text-[0.85em] px-1 py-0.5 rounded bg-bg-elevated border border-border text-text-primary">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-bg-elevated border border-border rounded-lg p-3 my-2 overflow-x-auto text-text-primary">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border my-4" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-sm border border-border rounded">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-elevated">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left px-3 py-2 font-medium text-text-muted border-b border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-text-secondary border-b border-border-subtle align-top">
      {children}
    </td>
  ),
  img: ({ src, alt }) => (
    // Render as a plain, non-fetching reference. We intentionally do NOT emit an
    // <img> that hits an arbitrary agent-supplied URL from the dashboard origin.
    <span className="text-text-muted text-xs italic">
      [image{alt ? `: ${alt}` : ""}{typeof src === "string" && src ? ` — ${src}` : ""}]
    </span>
  ),
};

export function MarkdownBody({ children }: { children: string }) {
  const body = (children ?? "").trim();
  if (!body) {
    return <p className="text-text-muted text-sm italic">Empty section.</p>;
  }
  return (
    <div className="min-w-0">
      <ReactMarkdown components={components}>{body}</ReactMarkdown>
    </div>
  );
}
