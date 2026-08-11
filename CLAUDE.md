## hindsight memory

This project uses the `hindsight` MCP server (registered in `.mcp.json`) for long-term memory, shared with the antigravity setup for this codebase.

When calling `hindsight` MCP tools (`retain`, `sync_retain`, `recall`, `get_document`, etc.):

- **Retaining** (`retain`/`sync_retain`): required param is `content` (string) — do NOT use `text`. Optional: `context` (string, logical grouping e.g. `forson-business-suite-ar-plan-phase2`), `tags` (array of strings, e.g. `["forson-business-suite", "ar_phase2"]`), `metadata` (object).
- **Recalling** (`recall`): required param is `query` (string). Optional: `tags` (array to filter), `max_tokens` (int, default 4096).
- Use the `retain-to-hindsight` skill for the full end-of-session retention workflow (what's worth retaining, atomic memory grouping, `sync_retain` vs `retain`, mental models, directives).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
