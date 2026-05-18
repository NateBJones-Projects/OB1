"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormattedDate } from "@/components/FormattedDate";
import { SearchBar } from "@/components/SearchBar";
import { TypeBadge } from "@/components/ThoughtCard";
import type { GraphNode, GraphResponse } from "@/lib/types";

type SearchResult = {
  id: string;
  content: string;
  type: string;
  created_at: string;
  metadata?: {
    topics?: string[];
    people?: string[];
  };
};

const CANVAS_WIDTH = 1120;
const CANVAS_HEIGHT = 680;
const CENTER_X = CANVAS_WIDTH / 2;
const CENTER_Y = CANVAS_HEIGHT / 2;

const NODE_COLORS: Record<
  string,
  { fill: string; stroke: string; text: string }
> = {
  idea: { fill: "rgba(251, 191, 36, 0.18)", stroke: "#fbbf24", text: "#fde68a" },
  task: { fill: "rgba(96, 165, 250, 0.18)", stroke: "#60a5fa", text: "#bfdbfe" },
  person_note: { fill: "rgba(52, 211, 153, 0.18)", stroke: "#34d399", text: "#a7f3d0" },
  reference: { fill: "rgba(148, 163, 184, 0.18)", stroke: "#94a3b8", text: "#cbd5e1" },
  decision: { fill: "rgba(139, 92, 246, 0.18)", stroke: "#8b5cf6", text: "#ddd6fe" },
  lesson: { fill: "rgba(251, 146, 60, 0.18)", stroke: "#fb923c", text: "#fdba74" },
  meeting: { fill: "rgba(34, 211, 238, 0.18)", stroke: "#22d3ee", text: "#a5f3fc" },
  journal: { fill: "rgba(244, 114, 182, 0.18)", stroke: "#f472b6", text: "#fbcfe8" },
};

function clampDepth(value: number): 1 | 2 {
  return value >= 2 ? 2 : 1;
}

function getNodeColors(type: string) {
  return NODE_COLORS[type] ?? NODE_COLORS.reference;
}

function truncateLabel(value: string, max = 22) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function polarPosition(
  index: number,
  total: number,
  radiusX: number,
  radiusY: number
) {
  const angle = (-Math.PI / 2) + (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: CENTER_X + Math.cos(angle) * radiusX,
    y: CENTER_Y + Math.sin(angle) * radiusY,
  };
}

function buildNodePositions(graph: GraphResponse) {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(graph.centerId, { x: CENTER_X, y: CENTER_Y });

  const ringOne = graph.nodes.filter((node) => node.ring === 1);
  const ringTwo = graph.nodes.filter((node) => node.ring === 2);

  ringOne.forEach((node, index) => {
    positions.set(node.id, polarPosition(index, ringOne.length, 250, 180));
  });

  ringTwo.forEach((node, index) => {
    positions.set(node.id, polarPosition(index, ringTwo.length, 430, 300));
  });

  return positions;
}

function graphNodeSize(node: GraphNode) {
  const base = node.ring === 0 ? 24 : node.ring === 1 ? 18 : 14;
  const importanceBoost = Math.min(Math.max(node.importance, 0), 100) / 25;
  return base + importanceBoost;
}

function GraphCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: GraphResponse;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const positions = buildNodePositions(graph);

  return (
    <div className="bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.16),_transparent_35%),linear-gradient(180deg,_rgba(17,17,24,0.98),_rgba(10,10,15,1))] border border-border rounded-2xl overflow-hidden">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="w-full h-[520px] md:h-[620px]"
        role="img"
        aria-label="Thought graph"
      >
        <defs>
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {graph.edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          const isSelected =
            edge.source === selectedNodeId || edge.target === selectedNodeId;

          return (
            <g key={`${edge.source}-${edge.target}`}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isSelected ? "#8b5cf6" : "rgba(139, 92, 246, 0.22)"}
                strokeWidth={isSelected ? 2.5 : 1.2}
              />
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const colors = getNodeColors(node.type);
          const isCenter = node.id === graph.centerId;
          const isSelected = node.id === selectedNodeId;
          const radius = graphNodeSize(node);

          return (
            <g
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              className="cursor-pointer"
            >
              <circle
                cx={position.x}
                cy={position.y}
                r={radius + (isSelected ? 5 : 0)}
                fill={isSelected ? "rgba(139, 92, 246, 0.16)" : "transparent"}
              />
              <circle
                cx={position.x}
                cy={position.y}
                r={radius}
                fill={colors.fill}
                stroke={isCenter ? "#ffffff" : colors.stroke}
                strokeWidth={isSelected ? 3 : isCenter ? 2.5 : 1.5}
                filter={isSelected ? "url(#node-glow)" : undefined}
              />
              {isCenter && (
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={4}
                  fill="#ffffff"
                />
              )}
              <text
                x={position.x}
                y={position.y + radius + 18}
                textAnchor="middle"
                fill={colors.text}
                fontSize={12}
                fontWeight={isSelected ? 700 : 500}
              >
                {truncateLabel(node.content)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function GraphExplorer({
  initialThoughtId,
  initialDepth = 1,
}: {
  initialThoughtId?: string;
  initialDepth?: 1 | 2;
}) {
  const router = useRouter();
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialThoughtId ?? null
  );
  const [depth, setDepth] = useState<1 | 2>(clampDepth(initialDepth));
  const [searchError, setSearchError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingGraph, setLoadingGraph] = useState(false);

  async function loadGraph(thoughtId: string, nextDepth = depth) {
    setLoadingGraph(true);
    setGraphError(null);

    try {
      const response = await fetch(
        `/api/graph?thought_id=${encodeURIComponent(thoughtId)}&depth=${nextDepth}`
      );
      const data = (await response.json()) as GraphResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to load graph");
      }

      setGraph(data);
      setSelectedNodeId(thoughtId);
      router.replace(`/graph?thought=${encodeURIComponent(thoughtId)}&depth=${nextDepth}`, {
        scroll: false,
      });
    } catch (error) {
      setGraphError(
        error instanceof Error ? error.message : "Failed to load graph"
      );
    } finally {
      setLoadingGraph(false);
    }
  }

  async function handleSearch(query: string, mode: "semantic" | "text") {
    setSearching(true);
    setSearchError(null);

    try {
      const response = await fetch(
        `/api/graph-search?q=${encodeURIComponent(query)}&mode=${mode}&page=1`
      );
      const data = (await response.json()) as {
        results?: SearchResult[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setSearchResults((data.results ?? []).slice(0, 8));
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error ? error.message : "Search failed"
      );
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (initialThoughtId) {
      void loadGraph(initialThoughtId, clampDepth(initialDepth));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThoughtId, initialDepth]);

  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnections =
    graph?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId
    ).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Graph</h1>
          <p className="text-text-secondary text-sm max-w-2xl">
            Explore a local thought graph around any note in your brain. Start
            with search, then pivot node by node the way you would in an
            Obsidian local graph.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-text-muted">
            Depth
          </span>
          {[1, 2].map((value) => {
            const active = depth === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  const nextDepth = clampDepth(value);
                  setDepth(nextDepth);
                  if (graph) {
                    void loadGraph(graph.centerId, nextDepth);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  active
                    ? "bg-violet-surface border-violet/30 text-violet"
                    : "bg-bg-surface border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {value} hop{value > 1 ? "s" : ""}
              </button>
            );
          })}
        </div>
      </div>

      <SearchBar
        onSearch={handleSearch}
        initialMode="semantic"
        placeholder="Search for a thought to center the graph..."
      />

      {(searching || searchError || searchResults.length > 0) && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary">
              Search Results
            </h2>
            {searching && (
              <span className="text-xs text-text-muted">Searching...</span>
            )}
          </div>

          {searchError && <p className="text-sm text-danger">{searchError}</p>}

          <div className="space-y-2">
            {searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => void loadGraph(result.id, depth)}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-violet/30 hover:bg-bg-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <TypeBadge type={result.type} />
                  <span className="text-xs text-text-muted ml-auto">
                    <FormattedDate date={result.created_at} />
                  </span>
                </div>
                <p className="text-sm text-text-secondary">
                  {truncateLabel(result.content, 140)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {graphError && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {graphError}
        </div>
      )}

      {!graph && !loadingGraph && (
        <div className="bg-bg-surface border border-dashed border-border rounded-2xl p-10 text-center">
          <p className="text-text-primary font-medium mb-2">
            Pick a thought to generate its local graph
          </p>
          <p className="text-sm text-text-secondary max-w-xl mx-auto">
            This first pass uses the project&apos;s existing connection signals,
            so we can visualize relationship neighborhoods immediately without
            adding a separate graph service.
          </p>
        </div>
      )}

      {loadingGraph && (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Building graph...
        </div>
      )}

      {graph && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <GraphCanvas
            graph={graph}
            selectedNodeId={selectedNodeId ?? graph.centerId}
            onSelectNode={setSelectedNodeId}
          />

          <aside className="space-y-4">
            <div className="bg-bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-medium text-text-primary">
                  Selection
                </h2>
                {graph.truncated && (
                  <span className="text-[11px] text-warning">
                    Graph trimmed for clarity
                  </span>
                )}
              </div>

              {selectedNode ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TypeBadge type={selectedNode.type} />
                    {selectedNode.id === graph.centerId && (
                      <span className="text-xs text-violet">center</span>
                    )}
                  </div>

                  <p className="text-sm text-text-primary leading-relaxed">
                    {selectedNode.preview}
                  </p>

                  <div className="text-xs text-text-muted space-y-1">
                    <p>ID: {selectedNode.id}</p>
                    <p>Connections shown: {selectedConnections}</p>
                    <p>
                      Created <FormattedDate date={selectedNode.created_at} />
                    </p>
                  </div>

                  {selectedNode.metadata.topics &&
                    selectedNode.metadata.topics.length > 0 && (
                      <div>
                        <p className="text-xs text-text-muted mb-1">Topics</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedNode.metadata.topics.map((topic) => (
                            <span
                              key={topic}
                              className="px-2 py-0.5 rounded bg-violet-surface text-violet text-xs"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {selectedNode.metadata.people &&
                    selectedNode.metadata.people.length > 0 && (
                      <div>
                        <p className="text-xs text-text-muted mb-1">People</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedNode.metadata.people.map((person) => (
                            <span
                              key={person}
                              className="px-2 py-0.5 rounded bg-bg-elevated text-text-secondary text-xs"
                            >
                              {person}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedNode.id !== graph.centerId && (
                      <button
                        type="button"
                        onClick={() => void loadGraph(selectedNode.id, depth)}
                        className="px-3 py-1.5 rounded-lg bg-violet hover:bg-violet-dim text-white text-sm transition-colors"
                      >
                        Center here
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  Select a node to inspect it.
                </p>
              )}
            </div>

            <div className="bg-bg-surface border border-border rounded-xl p-4">
              <h2 className="text-sm font-medium text-text-primary mb-2">
                What You&apos;re Seeing
              </h2>
              <p className="text-sm text-text-secondary leading-relaxed">
                The center node is the active thought. In MCP mode, nearby nodes
                are inferred from shared people and topic metadata returned by
                your deployed Open Brain tools, then expanded outward in two-hop
                mode for local exploration.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
