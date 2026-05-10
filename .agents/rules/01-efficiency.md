---
trigger: always_on
---

---
description: Global efficiency and formatting constraints
globs: **/*
---

# Token Efficiency & Output Rules

- **Zero-Yapping Policy:** Omit all conversational filler, pleasantries, and step-by-step explanations of standard Node.js or React boilerplate.
- **Role Boundary:** The developer manages all high-level logic and architectural decisions. Your role is strictly to handle the syntax and low-level implementation. 
- **Diff-First Output:** Never output full files unless explicitly requested. Provide only the necessary code chunks and exact line replacements.
- **Simplify & Prune:** Continuously look for ways to optimize logic, delete unnecessary code, and reduce the overall footprint of the implementation.