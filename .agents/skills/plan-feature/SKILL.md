---
name: plan-feature
description: >
  Activated by the /plan-feature slash command. Drives a planning-only session
  for a new or updated feature: queries the graph for context, produces an
  architectural plan, pauses for developer approval, then outputs a
  ready-to-paste structured prompt for a coding agent. Never writes application
  code itself.
---

# Plan-Feature Skill

## Purpose
Run a full planning cycle for a feature request and produce a **coding-agent prompt** the developer can paste into a fresh agent conversation. **This skill never implements code.**

---

## Activation
Trigger: user types `/plan-feature` followed by a short feature description.

Example:
```
/plan-feature Add bulk-export to PDF for invoices
```

---

## Execution Phases

Execute all phases strictly in order. **Do not skip or merge phases.**

---

### Phase 1 — Clarify Intent
If the feature description is ambiguous or missing key scope, ask **one focused clarifying question** before proceeding. Otherwise skip directly to Phase 2.

---

### Phase 2 — Graph Context Acquisition
Run graph queries to map topology relevant to the feature. Follow the **graph-first protocol** strictly:
- Use `npm run graph:query <topic>` to surface relevant nodes and edges.
- Run multiple targeted queries if the feature spans both `packages/api` and `packages/web`.
- **Do NOT read raw source files at this stage.**

---

### Phase 3 — Architectural Plan (Vibe Check)

Output a concise, structured plan in this exact format:

```
## 🗺️ Architectural Plan — [Feature Name]

### Scope
[One sentence describing what this feature does and which packages it touches.]

### Files to Create / Modify
| # | File | Action | Rationale |
|---|------|--------|-----------|
| 1 | path/to/file.ts | CREATE | ... |
| 2 | path/to/other.ts | MODIFY | ... |

### Risk Flags ⚠️
- [List any God Nodes or high-connectivity shared files that will be touched.]
- [Note if a /cascade workflow will be required after implementation.]

### Acceptance Criteria
- [ ] ...
- [ ] ...

### Data Model Changes
[If none: "None". Otherwise describe schema migrations or new fields.]

### API Contract Changes
[If none: "None". Otherwise describe new endpoints, tRPC procedures, or request/response shapes.]

### Frontend Impact
[If none: "None". Otherwise describe new pages, components, or route changes.]
```

**PAUSE.** Ask the developer:
> "Does this plan look correct? Approve to generate the coding-agent prompt, or tell me what to adjust."

Do not proceed to Phase 4 until the developer explicitly approves.

---

### Phase 4 — Generate Coding-Agent Prompt

Upon approval, output **only** the following structured markdown block — nothing else after it:

---
## 🤖 Coding-Agent Prompt — [Feature Name]

### Context
[One paragraph summarizing the approved architectural plan: what the feature does, which packages are involved, and key constraints.]

### Your Task
Implement the following feature: **[Feature Name]**

Follow the `/build-feature` workflow strictly (Phase 1 → 2 → 3 approval → 4 execution).

### Targeted Files
[Reproduce the Files to Create/Modify table from the approved plan.]

### Acceptance Criteria
[Reproduce the acceptance criteria checklist from the approved plan.]

### Data Model Changes
[From approved plan.]

### API Contract
[From approved plan.]

### Frontend Impact
[From approved plan.]

### Cascade Required?
[Yes / No — and if Yes, remind to run /cascade after implementation.]

### Mandatory Constraints
- **Graph-First:** Query the graph before reading any raw file. Do not read `node_modules` or `graphify-out/graph.json` directly.
- **Diff-First:** Output only the necessary diffs. Never output full files unless explicitly asked.
- **Zero-Yapping:** No filler, no boilerplate explanations. Code and diffs only.
- **Do NOT:**
  - Modify shared God Nodes without explicit developer approval.
  - Add new npm packages without running the `scan_dependencies` skill first.
  - Implement features outside the approved file list without pausing to ask.
---
