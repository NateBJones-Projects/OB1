# Graph Explorer

> One script, one HTML file: a force-directed knowledge graph of your Open Brain that opens from disk — no server, no build step, no npm install.

## What It Does

`export-graph.mjs` reads your brain over PostgREST, builds a graph of thoughts, topics, and people (or of extracted entities when the entity-extraction schema is installed), and writes a single `graph-explorer.html` with the data inlined. Open it in any browser and you get a canvas-rendered d3-force layout with zoom, pan, drag, search, per-kind toggles, a degree slider, a neighbors-only focus mode, and a detail pane for every node.

Upstream OB1 has data-layer graph work but no graph UI. This recipe fills that gap and complements:

- [`recipes/ob-graph`](../ob-graph/) — graph tables + MCP traversal tools (data layer, no visualization)
- [`recipes/wiki-compiler`](../wiki-compiler/) and [`recipes/wiki-synthesis`](../wiki-synthesis/) — compiled markdown wiki pages (text, no visualization)
- Karpathy-style LLM-wiki setups — you get the "graph view" without needing Obsidian; the SQL stays the source of truth and the HTML is a regenerable artifact

Two data sources, auto-detected:

| Mode | Works on | Nodes | Edges |
| ---- | -------- | ----- | ----- |
| `metadata` | Any brain that ran [`recipes/thought-enrichment`](../thought-enrichment/) | thoughts, `metadata.topics[]`, `metadata.people[]` | thought → topic, thought → person, optional topic ↔ topic co-occurrence |
| `entities` | Brains with [`schemas/entity-extraction`](../../schemas/entity-extraction/) (`entities`, `thought_entities`, `edges`), optionally [`schemas/typed-reasoning-edges`](../../schemas/typed-reasoning-edges/) (`thought_edges`) | thoughts + entities colored by `entity_type` | thought → entity mentions, typed entity ↔ entity relations, `supports` / `contradicts` / `supersedes` / … thought edges colored by relation |

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+ (uses built-in `fetch`; no dependencies)
- For `metadata` mode: thoughts enriched with `metadata.topics` / `metadata.people` — run [`recipes/thought-enrichment`](../thought-enrichment/) first
- For `entities` mode: [`schemas/entity-extraction`](../../schemas/entity-extraction/) applied and populated (the script auto-selects this mode when the tables exist)
- A browser with internet access the first time you open the HTML (d3 loads from cdnjs; the graph data itself is embedded)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
GRAPH EXPLORER -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________   (OPEN_BRAIN_URL)
  Secret key:            ____________   (OPEN_BRAIN_SERVICE_KEY)

GENERATED DURING SETUP
  Output folder:         ____________   (default: recipes/graph-explorer/output/)
  Alias map (optional):  ____________   (alias-map.json — gitignored)

--------------------------------------
```

## Steps

### 1. Configure credentials

Create `recipes/graph-explorer/.env.local` (gitignored):

```text
OPEN_BRAIN_URL=https://<your-project-ref>.supabase.co
OPEN_BRAIN_SERVICE_KEY=<your-secret-key>
```

Values in `.env.local` are layered over your shell environment, so exporting the same variables works too.

Done when: `node recipes/graph-explorer/export-graph.mjs --help` prints the flag list.

### 2. Dry run

```bash
node recipes/graph-explorer/export-graph.mjs --dry-run
```

This reads the brain, builds the graph, prints node/edge counts and the top hubs, and writes nothing.

Done when: you see a `mode:` line, non-zero `nodes:` and `edges:` counts, and a `top hubs:` list.

### 3. Export

```bash
node recipes/graph-explorer/export-graph.mjs
```

Writes `output/graph.json` and `output/graph-explorer.html` next to the script.

Done when: the script prints `wrote .../graph-explorer.html (N MB)`.

### 4. Open it

```bash
open recipes/graph-explorer/output/graph-explorer.html      # macOS
xdg-open recipes/graph-explorer/output/graph-explorer.html  # Linux
```

Or double-click the file. It runs from `file://` — nothing to serve.

Done when: the graph settles, the header shows node/edge counts, and clicking a node opens the detail pane on the right.

### 5. Tune it (optional)

Most brains have a few hub topics and a long tail of one-off labels. Start here:

```bash
# fold name variants into one node (see alias-map.example.json)
cp recipes/graph-explorer/alias-map.example.json recipes/graph-explorer/alias-map.json
node recipes/graph-explorer/export-graph.mjs --alias-map recipes/graph-explorer/alias-map.json

# add topic<->topic edges for topics that share at least 3 thoughts
node recipes/graph-explorer/export-graph.mjs --cooccurrence --min-weight 3

# only recent thoughts, and drop topic/person nodes linked to fewer than 3 thoughts
node recipes/graph-explorer/export-graph.mjs --since 2026-06-01 --min-degree 3

# put the full thought text in the detail pane
node recipes/graph-explorer/export-graph.mjs --include-content
```

Done when: the re-exported HTML reflects the change (the header timestamp updates on every export).

## Flags

| Flag | Default | What it does |
| ---- | ------- | ------------ |
| `--mode auto\|metadata\|entities` | `auto` | `auto` picks `entities` when `public.entities`, `public.thought_entities`, and `public.edges` all exist, otherwise `metadata` |
| `--since <date>` | — | Only thoughts created on/after this ISO date |
| `--limit <n>` | all | Stop after `n` thoughts (in `id` order) |
| `--min-degree <n>` | `2` | Drop topic / person / entity nodes with fewer links. Thought nodes are never pruned |
| `--exclude-tier <a,b>` | `restricted` | Sensitivity tiers to leave out entirely. `--exclude-tier restricted,personal` for a shareable graph; `--exclude-tier none` for everything |
| `--alias-map <file>` | — | JSON of canonical → variants for people and topics; see `alias-map.example.json` |
| `--cooccurrence` | off | Add topic ↔ topic edges weighted by the number of thoughts that mention both (metadata mode) |
| `--min-weight <n>` | `2` | Minimum shared thoughts for a co-occurrence edge |
| `--include-content` | off | Inline full thought content for the detail pane. Never applied to restricted-tier thoughts |
| `--out-dir <dir>` | `recipes/graph-explorer/output` | Where `graph.json` and `graph-explorer.html` go |
| `--from-json <file>` | — | Testing aid: build from a JSON array of thought rows instead of PostgREST (see below) |
| `--dry-run` | off | Print counts only; write nothing |

### Alias map

Enrichment output is only as consistent as the LLM that produced it: the same person shows up as `"Jane Doe"` in one thought and `"Jane"` in the next. The alias map folds variants into one node before edges are built:

```json
{
  "people": { "Jane Doe": ["Jane", "J. Doe"] },
  "topics": { "real-estate": ["real estate", "realestate"] }
}
```

Matching is case- and whitespace-insensitive. Keep your real map in `alias-map.json` (gitignored) — the committed example uses fictional names.

### Sensitivity and privacy

- `restricted` thoughts are excluded by default and their content is never inlined, even with `--include-content`.
- Labels are 80 characters, taken from `metadata.summary` when present, otherwise the first line of content.
- `graph.json` and `graph-explorer.html` contain whatever you exported. They live under `output/` (gitignored) — treat them like any other brain export and do not commit them.

### `--from-json` (testing aid)

Lets you exercise the graph builder and HTML generation without credentials or network: point it at a JSON array of thought rows in the shape PostgREST returns (`id`, `created_at`, `type`, `importance`, `source_type`, `sensitivity_tier`, `metadata: { summary, topics, people }`, optional `content`). It forces `metadata` mode and honors the same flags. Useful for developing the template against a saved sample, or for reviewing a PR without a live brain.

```bash
node recipes/graph-explorer/export-graph.mjs --from-json /path/to/sample.json --cooccurrence --dry-run
```

## Using the explorer

| Control | What it does |
| ------- | ------------ |
| Scroll / pinch | Zoom |
| Drag background | Pan |
| Drag node | Move and pin it (double-click to unpin; **Reheat** unpins all) |
| Click node | Open the detail pane: label, kind, date, type, importance, source, and its links grouped by kind. Click a link to jump to that node |
| Search box | Filters by label; non-matches dim. Enter selects the top match, Esc clears |
| Node kinds | Toggle thoughts / topics / people (or entity types) on and off; doubles as the legend with counts |
| Min degree | Hide nodes with fewer links than the slider value |
| Labels | Auto (hubs, plus everything once you zoom in), hubs only, all, or none |
| Neighbors only | With a node selected, show only it and its direct neighbors |
| Fit | Zoom to the visible graph |
| Theme | Toggle light / dark (defaults to your OS setting) |

Deep links: append `#select=<node id>&focus=1&q=<search>&theme=dark` to the file URL to open the explorer already focused on a node (node ids are shown in the detail pane, e.g. `topic:salesforce`). A small `window.graphExplorer` object (`select(id)`, `search(q)`, `visible()`, `selected()`) is exposed for console use and automated checks.

Rendering is canvas, not SVG, so a graph of ~5,000 nodes and ~15,000 edges stays interactive. Edges are batched by style and labels are budgeted per frame; if a very large brain still feels heavy, raise `--min-degree` or add `--since`.

## Expected Outcome

After step 3 the script prints something like:

```text
auto-detected mode: metadata
  thoughts fetched: 2546

mode: metadata
nodes: 3186
  thought        2546
  topic          556
  person         84
edges: 6803
  topic          4830
  person         1973
pruned: 1842 nodes below --min-degree
top hubs:
   1712  person       Jane Doe
    281  topic        real-estate
    ...

wrote .../output/graph.json
wrote .../output/graph-explorer.html (1.2 MB)
```

Opening the HTML shows a settled force layout: a few large hub nodes (your most-mentioned people and topics) surrounded by clusters of thought nodes, the legend on the left with counts per kind, and the header reporting `visible / total` nodes and edges plus the export timestamp. Clicking any node opens the detail pane; searching a topic name highlights every matching node.

## Troubleshooting

**Issue: `OPEN_BRAIN_URL missing` or `OPEN_BRAIN_SERVICE_KEY missing`**
Solution: create `recipes/graph-explorer/.env.local` with both values (Step 1), or export them in your shell. The script reads `.env.local` from its own folder, not the current directory.

**Issue: `GET thoughts -> 401` or `-> 403`**
Solution: the key is wrong or is the anon/publishable key. Use the secret (service-role) key from Supabase → Project Settings → API Keys. It never leaves your machine — only the generated HTML does.

**Issue: nodes are only thoughts; no topics or people**
Solution: `metadata.topics` / `metadata.people` are empty. Run [`recipes/thought-enrichment`](../thought-enrichment/) first. If enrichment ran but topics are still missing, see the "stringified metadata" note in that recipe's README.

**Issue: `note: column "sensitivity_tier" not found on thoughts`**
Solution: informational. The enhanced-thoughts columns (`type`, `importance`, `source_type`, `sensitivity_tier`) are optional; the export continues without them and tier filtering is skipped because there is nothing to filter on.

**Issue: the HTML opens but the canvas is blank and a red banner says d3 failed to load**
Solution: the page pulls d3 7.9.0 from `cdnjs.cloudflare.com`. Connect to the internet and reload; after the first load the browser cache usually serves it offline.

**Issue: one giant hub swallows the layout**
Solution: that is usually you (the brain's owner appears in most `people` lists). Either uncheck `person` in the legend, raise the degree slider, or use an alias map so the variants collapse into one node and then hide it. Adding `--cooccurrence` also gives topics structure independent of the hub.

**Issue: the same person or topic appears as several nodes**
Solution: enrichment produced name variants. Build an alias map (see above) and pass `--alias-map`.

**Issue: `--mode entities` fails with a message about missing tables**
Solution: install [`schemas/entity-extraction`](../../schemas/entity-extraction/) and run its worker so `entities`, `thought_entities`, and `edges` are populated. Until then, use `--mode metadata`.

**Issue: the layout is slow with a very large brain**
Solution: export a subset (`--since`, `--limit`), raise `--min-degree`, or skip `--cooccurrence`. In the page, unchecking `thought` leaves just the topic/people skeleton, which is much lighter.
