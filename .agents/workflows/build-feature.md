---
description: The standard 4-Phase sequence for building new features or refactoring.
---

---
description: The standard 4-Phase sequence for building new features or refactoring.
---

# Feature Implementation Sequence

Execute the following phases strictly in order. Do not proceed to Phase 4 without explicit developer approval.

**Phase 1: Context Acquisition**
- Query the graph to trace relevant cross-package dependencies between the API and Web packages. 

**Phase 2: Impact Analysis**
- Identify the exact files for creation or modification.
- Flag any highly connected "God Nodes" (e.g., core configs, shared utilities, root layouts) to warn the developer of structural risk.

**Phase 3: The Vibe Check**
- Output a concise, bulleted architectural plan based *only* on the graph data.
- PAUSE. Ask: "Do you approve of this architectural plan?" 
- *Crucial: Do not read raw files or generate application code yet.*

**Phase 4: Targeted Execution & Verification**
- Upon developer approval, read only the targeted files identified in the plan.
- Generate the requested feature code, adhering strictly to the zero-yapping and diff-first policies.
- Add or update matching test suites under `packages/<package>/tests/` for all new or modified logic paths.
- Run `npm test` to empirically verify clean execution before declaring completion.
- Run `graphify update .` to keep the knowledge graph synchronized.