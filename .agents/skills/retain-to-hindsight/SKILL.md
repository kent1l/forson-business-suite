---
name: retain-to-hindsight
description: >-
  Use when the user asks to "retain", "save to hindsight", or "remember" details
  from the current session. Also activate proactively at the end of significant
  coding sessions, when important architectural decisions are made, lessons are
  learned, or non-obvious implementation details are discovered. Covers all
  hindsight MCP tools: sync_retain, recall, reflect, update_memory,
  invalidate_memory, create_mental_model, create_directive.
---

# Retain to Hindsight

This skill governs how to use the **hindsight MCP** to persist important knowledge
from sessions into long-term memory for future retrieval.

---

## Tool Reference

| Tool | When to Use |
|---|---|
| `sync_retain` | Primary write tool. Blocks until stored. Use for all end-of-session saves. |
| `retain` | Async write. Use when fire-and-forget is acceptable (e.g., quick single fact mid-session). |
| `recall` | Search memories by semantic query. Use at session start to restore prior context. |
| `reflect` | Deep reasoning across stored memories. Use for "what's the best approach given what we know?" |
| `update_memory` | Correct an existing memory (wrong fact, typo, outdated detail). Requires `memory_id`. |
| `invalidate_memory` | Soft-retire a stale or wrong memory without deleting it (fully reversible). |
| `list_memories` | Browse/audit stored memories. Use to check what's already retained before writing. |
| `create_mental_model` | Create a living pinned reflection (e.g., "SOA PDF Architecture"). Auto-regenerates after consolidation. |
| `create_directive` | Add a standing instruction that shapes future reflections (e.g., "Always tag forson memories with project name"). |

---

## Step-by-Step: End-of-Session Retention

### Step 1 — Identify What's Worth Retaining

Ask: **"Would a future agent session be worse off without knowing this?"**

✅ **Retain:**
- Architectural decisions and their rationale (why X over Y)
- File paths, function names, and their roles in the system
- Non-obvious implementation details (e.g., magic byte detection, Docker constraints)
- Lessons learned / failed approaches and why they failed
- Exact CSS/config values that were finalized
- Template variable names and section ordering
- Test commands and their expected output
- User preferences stated explicitly (e.g., "no continuation notice text")

❌ **Do NOT retain:**
- Transient debug output
- Intermediate failed states that were immediately corrected
- Things already documented in AGENTS.md or the codebase itself
- Generic Node.js / React boilerplate knowledge

### Step 2 — Group Into Atomic Memories

Each `sync_retain` call should cover **one coherent topic**. Avoid mega-memories.
Good granularity: one memory per file/feature/concept.

```
✅ "SOA PDF @page margins: top=10mm, right=10mm, bottom=18mm, left=10mm..."
✅ "Puppeteer must run inside Docker container — host OS lacks libasound.so.2..."
❌ "We worked on the SOA PDF today and did many things..." (too vague)
```

### Step 3 — Call `sync_retain` (Not `retain`)

Always use **`sync_retain`** for end-of-session saves so memories are immediately
available for recall before the conversation ends.

**Correct call structure:**
```json
{
  "content": "<specific, self-contained fact with enough context to be useful alone>",
  "context": "<project-name or domain, e.g. 'forson-business-suite'>",
  "tags": ["<topic>", "<subtopic>", "<project-slug>"]
}
```

**Tagging conventions for this project:**
- Always include `"forson-business-suite"` as a tag for project-scoped memories
- Use topic tags: `"soa-pdf"`, `"paperless"`, `"architecture"`, `"lessons-learned"`,
  `"template"`, `"page-layout"`, `"receipt-images"`, `"testing"`, `"docker"`

### Step 4 — Spawn a Subagent for Bulk Saves

When saving 5+ memories, invoke a `self` subagent to call `sync_retain` sequentially
so the main agent context stays clean. Report back with "Done" when complete.

```
invoke_subagent(TypeName="self", Role="Hindsight Memory Writer",
  Prompt="Call sync_retain sequentially for the following N memories: ...")
```

### Step 5 — Create a Mental Model (Optional, for Major Features)

After a large feature session, create a mental model for future `reflect` queries:

```json
{
  "name": "SOA PDF Architecture",
  "source_query": "What is the current architecture, file structure, and key decisions for the SOA PDF generation system?",
  "tags": ["soa-pdf", "forson-business-suite"],
  "tags_match": "any",
  "trigger_refresh_after_consolidation": true
}
```

---

## Step-by-Step: Session Start (Recall Prior Context)

Before starting work on a known feature, call `recall` to restore context:

```json
{
  "query": "SOA PDF generation architecture and recent decisions",
  "tags": ["soa-pdf", "forson-business-suite"],
  "tags_match": "any"
}
```

---

## What Constitutes a High-Quality Memory

A good memory is:
- **Self-contained:** Readable and useful without needing the original conversation
- **Specific:** Includes exact values, paths, function names — not vague descriptions
- **Contextualized:** Explains *why* a decision was made, not just *what*
- **Actionable:** A future agent can act on it without asking follow-up questions

**Template for a good memory:**
```
"<Component/File>: <what it does / its role>. <Key detail or constraint>.
 <Why this decision was made or what was tried and failed>.
 <Exact values / paths / commands if relevant>."
```

---

## Correction Workflow

If a stored memory is wrong or outdated:

1. `list_memories` with `q="<topic>"` to find the memory and its `memory_id`
2. `update_memory` to correct the text (re-embeds automatically)
3. Or `invalidate_memory` if it's fully stale (soft-delete, reversible)

---

## Proactive Retention Triggers

Retain **without being asked** when any of these occur:
- A non-obvious implementation detail is finalized
- An approach is tried, fails, and a different one succeeds (retain both + reason)
- A user preference or constraint is stated explicitly
- A reference commit SHA is identified as authoritative
- A file's role in the system is clarified
- A test command or Docker command is confirmed working
