import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { mcpFetchThought, mcpSearchThoughts, type McpThoughtDocument } from "@/lib/openBrainMcp";
import type { GraphEdge, GraphNode } from "@/lib/types";

const MAX_FIRST_RING = 10;
const MAX_GRAPH_NODES = 24;

type Meta = {
  type?: string;
  topics?: string[];
  people?: string[];
  created_at?: string;
};

function clampDepth(value: number): 1 | 2 {
  return value >= 2 ? 2 : 1;
}

function normalizeMeta(document: McpThoughtDocument): Meta {
  const metadata = document.metadata || {};
  return {
    type: typeof metadata.type === "string" ? metadata.type : "reference",
    topics: Array.isArray(metadata.topics) ? metadata.topics.filter((v): v is string => typeof v === "string") : [],
    people: Array.isArray(metadata.people) ? metadata.people.filter((v): v is string => typeof v === "string") : [],
    created_at:
      typeof metadata.created_at === "string"
        ? metadata.created_at
        : undefined,
  };
}

function toGraphNode(
  document: McpThoughtDocument,
  ring: 0 | 1 | 2
): GraphNode {
  const meta = normalizeMeta(document);
  return {
    id: document.id,
    type: meta.type || "reference",
    importance: 0,
    content: document.text,
    preview:
      document.text.length > 180
        ? `${document.text.slice(0, 180)}...`
        : document.text,
    created_at: meta.created_at || new Date().toISOString(),
    metadata: {
      topics: meta.topics,
      people: meta.people,
    },
    ring,
  };
}

function overlap(a: string[], b: string[]) {
  const right = new Set(b);
  return a.filter((item) => right.has(item));
}

function buildEdge(
  source: McpThoughtDocument,
  target: McpThoughtDocument
): GraphEdge {
  const sourceMeta = normalizeMeta(source);
  const targetMeta = normalizeMeta(target);
  const sharedTopics = overlap(sourceMeta.topics || [], targetMeta.topics || []);
  const sharedPeople = overlap(sourceMeta.people || [], targetMeta.people || []);

  return {
    source: source.id,
    target: target.id,
    overlap_count: sharedTopics.length + sharedPeople.length,
    shared_topics: sharedTopics,
    shared_people: sharedPeople,
  };
}

function buildQueries(document: McpThoughtDocument) {
  const meta = normalizeMeta(document);
  const queries = [
    ...(meta.topics || []).slice(0, 3),
    ...(meta.people || []).slice(0, 3),
  ];

  if (queries.length === 0) {
    const fallback = document.text
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 8)
      .join(" ");
    if (fallback) queries.push(fallback);
  }

  return Array.from(new Set(queries));
}

async function collectNeighbors(
  apiKey: string,
  seed: McpThoughtDocument,
  excludeIds: Set<string>,
  maxNeighbors: number
) {
  const queries = buildQueries(seed);
  const candidates = new Map<string, McpThoughtDocument>();

  for (const query of queries) {
    const results = await mcpSearchThoughts(apiKey, query).catch(() => []);
    for (const result of results) {
      if (excludeIds.has(result.id) || result.id === seed.id) continue;
      candidates.set(result.id, result);
    }
  }

  return Array.from(candidates.values())
    .map((candidate) => ({
      document: candidate,
      edge: buildEdge(seed, candidate),
    }))
    .filter((entry) => (entry.edge.overlap_count || 0) > 0 || queries.length === 1)
    .sort((a, b) => (b.edge.overlap_count || 0) - (a.edge.overlap_count || 0))
    .slice(0, maxNeighbors);
}

export async function GET(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const thoughtId = request.nextUrl.searchParams.get("thought_id");
  const depth = clampDepth(
    Number(request.nextUrl.searchParams.get("depth") || "1")
  );

  if (!thoughtId?.trim()) {
    return NextResponse.json(
      { error: "Valid thought_id is required" },
      { status: 400 }
    );
  }

  try {
    const centerThought = await mcpFetchThought(apiKey, thoughtId.trim());
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    let truncated = false;

    nodes.set(centerThought.id, toGraphNode(centerThought, 0));

    const firstRing = await collectNeighbors(
      apiKey,
      centerThought,
      new Set([centerThought.id]),
      MAX_FIRST_RING
    );

    for (const entry of firstRing) {
      nodes.set(entry.document.id, toGraphNode(entry.document, 1));
      edges.set(`${centerThought.id}->${entry.document.id}`, entry.edge);
    }

    if (depth === 2) {
      for (const entry of firstRing) {
        const usedIds = new Set(nodes.keys());
        const secondRing = await collectNeighbors(
          apiKey,
          entry.document,
          usedIds,
          3
        );

        for (const second of secondRing) {
          if (!nodes.has(second.document.id)) {
            if (nodes.size >= MAX_GRAPH_NODES) {
              truncated = true;
              continue;
            }
            nodes.set(second.document.id, toGraphNode(second.document, 2));
          }

          edges.set(`${entry.document.id}->${second.document.id}`, second.edge);
        }
      }
    }

    return NextResponse.json({
      centerId: centerThought.id,
      depth,
      truncated,
      nodes: Array.from(nodes.values()).sort((a, b) =>
        a.ring === b.ring ? a.content.localeCompare(b.content) : a.ring - b.ring
      ),
      edges: Array.from(edges.values()),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build graph" },
      { status: 500 }
    );
  }
}
