#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Args = {
  path?: string;
  manifest?: string;
  slackChannel?: string;
  after?: string;
  before?: string;
  programId: string;
  endpoint: string;
  source: string;
  limit: number;
  dryRun: boolean;
  minChars: number;
};

type ImportItem = {
  title: string;
  text: string;
  source: string;
  sourceRef: string;
  eventAt?: string;
  surroundingContext?: string;
};

type ToolTextContent = {
  type: "text";
  text: string;
};

type ManifestItem = {
  title?: string;
  text?: string;
  path?: string;
  url?: string;
  source?: string;
  source_ref?: string;
  event_at?: string;
  date?: string;
  surrounding_context?: string;
};

const MONTHS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12",
};

function usage(): never {
  console.log(`Xenith bulk importer

Usage:
  deno run --allow-env --allow-net --allow-read --env-file=server/.env.xenith.local \\
    recipes/xenith-bulk-import/import-xenith-bulk.ts --path imports/xenith/inbox --dry-run

Inputs:
  --path FILE_OR_DIR          Import .txt, .md, .vtt, or .srt files
  --manifest FILE.json        Import manifest entries with text/path/url/date metadata
  --slack-channel CHANNEL_ID  Import messages from Slack conversations.history

Options:
  --after YYYY-MM-DD          Only import items after this date
  --before YYYY-MM-DD         Only import items before this date
  --program xenith            Program id (default: xenith)
  --endpoint URL              MCP endpoint (default from MCP_ENDPOINT or localhost + MCP_ACCESS_KEY)
  --source NAME               Source label for file imports (default: bulk_import)
  --min-chars N               Skip short items (default: 40)
  --limit N                   Max items to process
  --dry-run                   Parse and print, but do not ingest

Slack requires SLACK_BOT_TOKEN in the environment.`);
  Deno.exit(1);
}

function parseArgs(): Args {
  const args = Deno.args;
  const parsed: Args = {
    programId: "xenith",
    endpoint: "",
    source: "bulk_import",
    limit: 0,
    dryRun: false,
    minChars: 40,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) usage();
      return value;
    };

    switch (arg) {
      case "--path":
        parsed.path = next();
        break;
      case "--manifest":
        parsed.manifest = next();
        break;
      case "--slack-channel":
        parsed.slackChannel = next();
        break;
      case "--after":
        parsed.after = next();
        break;
      case "--before":
        parsed.before = next();
        break;
      case "--program":
        parsed.programId = next();
        break;
      case "--endpoint":
        parsed.endpoint = next();
        break;
      case "--source":
        parsed.source = next();
        break;
      case "--limit":
        parsed.limit = Number(next());
        break;
      case "--min-chars":
        parsed.minChars = Number(next());
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        usage();
    }
  }

  if (!parsed.path && !parsed.manifest && !parsed.slackChannel) usage();

  if (!parsed.endpoint) {
    const envEndpoint = Deno.env.get("MCP_ENDPOINT");
    const key = Deno.env.get("MCP_ACCESS_KEY");
    parsed.endpoint = envEndpoint ||
      (key ? `http://localhost:8000/?key=${key}` : "");
  }

  if (!parsed.dryRun && !parsed.endpoint) {
    throw new Error(
      "MCP endpoint missing. Set MCP_ENDPOINT or MCP_ACCESS_KEY, or pass --endpoint.",
    );
  }

  return parsed;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const iso = trimmed.match(
    /\b(20\d{2}|19\d{2})[-_/\.](\d{1,2})[-_/\.](\d{1,2})\b/,
  );
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const compact = trimmed.match(/\b(20\d{2}|19\d{2})(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const us = trimmed.match(
    /\b(\d{1,2})[-_/\.](\d{1,2})[-_/\.](20\d{2}|19\d{2})\b/,
  );
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;

  const words = trimmed.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2}|19\d{2})\b/i,
  );
  if (words) {
    return `${words[3]}-${MONTHS[words[1].toLowerCase()]}-${
      words[2].padStart(2, "0")
    }`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  return undefined;
}

function extractEventDate(title: string, text: string): string | undefined {
  const fromTitle = normalizeDate(title);
  if (fromTitle) return fromTitle;

  const firstLines = text.split(/\r?\n/).slice(0, 40).join("\n");
  const labelled = firstLines.match(
    /(?:date|meeting date|recorded|created|timestamp)\s*:\s*([^\n]+)/i,
  );
  if (labelled) {
    const fromLabel = normalizeDate(labelled[1]);
    if (fromLabel) return fromLabel;
  }

  return normalizeDate(firstLines);
}

function stripTranscriptNoise(text: string, extension: string): string {
  if (![".vtt", ".srt"].includes(extension)) return text.trim();

  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed === "WEBVTT") return false;
      if (/^\d+$/.test(trimmed)) return false;
      if (
        /^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}/.test(
          trimmed,
        )
      ) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

function extensionOf(path: string): string {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "";
}

async function collectFiles(path: string): Promise<string[]> {
  const stat = await Deno.stat(path);
  if (stat.isFile) return [path];
  if (!stat.isDirectory) return [];

  const files: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    const child = `${path.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...await collectFiles(child));
    } else if (entry.isFile) {
      files.push(child);
    }
  }
  return files;
}

async function itemsFromPath(
  path: string,
  source: string,
): Promise<ImportItem[]> {
  const files = await collectFiles(path);
  const supported = files.filter((file) =>
    [".txt", ".md", ".vtt", ".srt"].includes(extensionOf(file))
  );
  const items: ImportItem[] = [];

  for (const file of supported) {
    const raw = await Deno.readTextFile(file);
    const title = file.split("/").pop() || file;
    const text = stripTranscriptNoise(raw, extensionOf(file));
    items.push({
      title,
      text,
      source,
      sourceRef: file,
      eventAt: extractEventDate(title, text),
    });
  }

  return items;
}

async function itemsFromManifest(
  path: string,
  fallbackSource: string,
): Promise<ImportItem[]> {
  const parsed = JSON.parse(await Deno.readTextFile(path)) as ManifestItem[] | {
    items: ManifestItem[];
  };
  const entries = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(entries)) {
    throw new Error("Manifest must be an array or { items: [...] }.");
  }

  const items: ImportItem[] = [];
  for (const entry of entries) {
    let text = entry.text || "";
    if (!text && entry.path) text = await Deno.readTextFile(entry.path);
    if (!text && entry.url) {
      console.warn(`Skipping live URL without text export: ${entry.url}`);
      continue;
    }

    const title = entry.title || entry.path?.split("/").pop() || entry.url ||
      "manifest item";
    const eventAt = normalizeDate(entry.event_at || entry.date) ||
      extractEventDate(title, text);
    items.push({
      title,
      text,
      source: entry.source || fallbackSource,
      sourceRef: entry.source_ref || entry.url || entry.path || title,
      eventAt,
      surroundingContext: entry.surrounding_context,
    });
  }

  return items;
}

async function itemsFromSlack(
  channel: string,
  args: Args,
): Promise<ImportItem[]> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required for --slack-channel.");
  }

  const params = new URLSearchParams({
    channel,
    limit: String(args.limit && args.limit < 200 ? args.limit : 200),
  });
  if (args.after) {
    params.set("oldest", String(new Date(args.after).getTime() / 1000));
  }
  if (args.before) {
    params.set("latest", String(new Date(args.before).getTime() / 1000));
  }

  const response = await fetch(
    `https://slack.com/api/conversations.history?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error || "unknown"}`);

  return (data.messages || [])
    .filter((message: Record<string, unknown>) =>
      typeof message.text === "string"
    )
    .map((message: Record<string, unknown>) => {
      const ts = String(message.ts || "");
      const eventAt = ts
        ? new Date(Number(ts.split(".")[0]) * 1000).toISOString()
        : undefined;
      return {
        title: `slack-${channel}-${ts}`,
        text: String(message.text),
        source: "slack",
        sourceRef: `${channel}:${ts}`,
        eventAt,
        surroundingContext: `Slack channel ${channel}`,
      };
    });
}

function withinDateRange(item: ImportItem, args: Args): boolean {
  if (!item.eventAt) return true;
  const event = new Date(item.eventAt).getTime();
  if (args.after && event < new Date(args.after).getTime()) return false;
  if (args.before && event > new Date(args.before).getTime()) return false;
  return true;
}

async function connectClient(endpoint: string): Promise<Client> {
  const client = new Client({ name: "xenith-bulk-import", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return client;
}

async function ingestItem(
  client: Client,
  item: ImportItem,
  programId: string,
): Promise<string> {
  const result = await client.callTool({
    name: "capture_transcript",
    arguments: {
      transcript: item.text,
      program_id: programId,
      source_ref: item.sourceRef,
      event_at: item.eventAt,
      surrounding_context: item.surroundingContext ||
        `${item.source}: ${item.title}`,
    },
  });

  const content = Array.isArray(result.content)
    ? result.content as ToolTextContent[]
    : [];
  return content
    .filter((part): part is ToolTextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function main() {
  const args = parseArgs();
  let items: ImportItem[] = [];

  if (args.path) items.push(...await itemsFromPath(args.path, args.source));
  if (args.manifest) {
    items.push(...await itemsFromManifest(args.manifest, args.source));
  }
  if (args.slackChannel) {
    items.push(...await itemsFromSlack(args.slackChannel, args));
  }

  items = items
    .filter((item) => item.text.trim().length >= args.minChars)
    .filter((item) => withinDateRange(item, args));

  if (args.limit > 0) items = items.slice(0, args.limit);

  console.log(`Xenith bulk import`);
  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Program: ${args.programId}`);
  console.log(`Items: ${items.length}`);
  console.log();

  if (args.dryRun) {
    for (const [index, item] of items.entries()) {
      console.log(
        `${index + 1}. ${item.title} | event_at=${
          item.eventAt || "unknown"
        } | source_ref=${item.sourceRef} | chars=${item.text.length}`,
      );
    }
    return;
  }

  const client = await connectClient(args.endpoint);
  let imported = 0;
  let errors = 0;

  try {
    for (const [index, item] of items.entries()) {
      try {
        console.log(`[${index + 1}/${items.length}] Importing ${item.title}`);
        const summary = await ingestItem(client, item, args.programId);
        console.log(summary);
        imported += 1;
      } catch (error) {
        errors += 1;
        console.error(
          `Error importing ${item.title}: ${(error as Error).message}`,
        );
      }
      console.log();
    }
  } finally {
    await client.close();
  }

  console.log(`Done. Imported: ${imported}. Errors: ${errors}.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Fatal: ${(error as Error).message}`);
    Deno.exit(1);
  });
}
