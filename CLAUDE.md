## hindsight memory

This project uses the `hindsight` MCP server (registered in `.mcp.json`) for long-term memory, shared with the antigravity setup for this codebase.

When calling `hindsight` MCP tools (`retain`, `sync_retain`, `recall`, `get_document`, etc.):

- **Retaining** (`retain`/`sync_retain`): required param is `content` (string) — do NOT use `text`. Optional: `context` (string, logical grouping e.g. `forson-business-suite-ar-plan-phase2`), `tags` (array of strings, e.g. `["forson-business-suite", "ar_phase2"]`), `metadata` (object).
- **Recalling** (`recall`): required param is `query` (string). Optional: `tags` (array to filter), `max_tokens` (int, default 4096).
- Use the `retain-to-hindsight` skill for the full end-of-session retention workflow (what's worth retaining, atomic memory grouping, `sync_retain` vs `retain`, mental models, directives).

### Using hindsight efficiently (token discipline)

Hindsight and Claude Code's own built-in memory serve different jobs — do not let them duplicate each other:

- **Built-in Claude memory** (auto-loaded, zero-cost per turn) is for durable, high-level behavioral lessons — standing preferences, corrections the user gave, tooling conventions. Keep it small.
- **Hindsight** (costs a tool call + tokens per `recall`) is for everything else: architecture decisions, file/function roles, non-obvious implementation gotchas, past debugging lessons. It scales to much more detail than the built-in memory should ever hold.

Recall discipline — do NOT recall by default:
- Do **not** call `recall` at the start of every session "just in case." Only call it when the current request clearly touches a domain likely to have prior context (a named feature, a file/module you don't already understand, a bug that smells like a repeat, an architectural question).
- Keep `query` narrow and specific to the task at hand — not a broad restatement of the whole user request. Narrow queries return fewer, more relevant memories and cost fewer tokens to both retrieve and read.
- Use `tags` to scope the search (e.g. to a feature or subsystem) whenever the task is clearly inside one, instead of an untagged project-wide search.
- Set `max_tokens` deliberately for the task size — don't default to pulling the max budget when a quick fact-check only needs a couple hundred tokens.
- Prefer `graphify query`/`explain`/`path` (see below) for structural "where is X / what calls Y" questions — those are free (local graph traversal, no LLM tokens) and often answer what you'd otherwise `recall` for. Reach for hindsight specifically for the *why* (decisions, lessons, rationale) that the code graph can't tell you.

Retain discipline (see the `retain-to-hindsight` skill for full detail):
- Retain atomic, self-contained facts — one topic per call — not session transcripts or vague summaries.
- Skip anything already discoverable from the code itself or from graphify (file structure, call graphs) — hindsight is for knowledge that isn't recoverable by reading the repo.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## other skills to use proactively on this repo

- **dataviz**: load this skill before writing or editing any chart/dashboard code in `packages/web` (this app uses `recharts`, e.g. the dashboard work in `DASHBOARD_ENHANCEMENT_SUMMARY.md`). Load it before choosing chart colors or layout, not after.
- **security-review**: run this before merging or finalizing any change touching auth (`jsonwebtoken`, `bcrypt`), file uploads (`multer`), or PDF/document generation (`puppeteer`, `pdf-lib`) in `packages/api` — this is a financial/business-data app, so auth and file-handling changes get a security pass by default.
- **run**: use this to actually launch and verify changes in the browser/dev stack (`docker-compose.dev.yml`, `packages/web` via Vite, `packages/api` via nodemon) instead of assuming a change works — especially for anything UI-facing in `packages/web`.
