# Universal `plan-to-docs` Skill — Graphify and Hindsight Edition

Use the following prompt to establish a reusable `plan-to-docs` skill in an agent environment where both Graphify and Hindsight are available.

```text
# Establish and Use the `plan-to-docs` Skill

Create or adopt a skill named `plan-to-docs`. Its purpose is to turn a
multi-phase implementation plan into a durable, repository-checked-in handoff
document that a new agent can read without access to the original conversation.

The handoff must document verified implementation reality: what was built, what
was verified, what remains, what was deliberately deferred, and why important
decisions were made.

## Activation conditions

Use this skill when:

- the user asks for a plan, implementation, or developer handoff document;
- a multi-phase effort is paused, handed off, deprioritized, or completed;
- another agent must continue work without the current conversation;
- a substantial feature has been implemented and its status needs to remain
  durable in the repository.

Do not use it for a trivial change unless the user explicitly requests a
handoff or plan document.

## Non-negotiable rule: document reality, not intentions

Before writing, establish ground truth from the repository and runtime. Do not
trust memory, an old plan, or another agent's completion claim without checking.

For each phase, classify it as exactly one of:

- Done
- Partially done
- Not started
- Deferred

For every phase that is not fully done, itemize the individual work items. Never
write only `Phase 2 — partially done`. Use explicit checkboxes and explanations:

    - [x] Added the migration and verified it locally.
    - [x] Added the API route and passing success-path tests.
    - [ ] Authorization checks are not implemented yet.
    - [ ] Timeout and retry behavior still needs tests.

Distinguish implemented, committed, tested, manually inspected, deployed, and
not verified. A file existing is not proof that its behavior works.

## Step 1 — Establish ground truth

Run the repository's equivalents of:

    git status --short
    git log --oneline -20
    git branch --show-current
    git diff <base-branch>...HEAD --stat
    git diff

Inspect the original plan, issue, or planning file if available. Treat it as
intent and context, never as implementation evidence. Inspect durable artifacts
directly when relevant: migrations, schemas, routes, services, generated files,
configuration, deployment manifests, workers, queues, and integrations.

Map every planned phase to actual evidence. If the original plan cannot be
found, reconstruct phases from the conversation, issue, commit history, diff,
and current source, and say that the original plan was unavailable.

## Step 2 — Use Graphify before making architectural claims

Graphify is available and must be used for repository understanding.

If `graphify-out/graph.json` exists, first use scoped queries rather than
dumping broad source files:

    graphify query "<feature or subsystem>"
    graphify explain "<important concept>"
    graphify path "<source node>" "<destination node>"

Use `graphify-out/wiki/index.md` for broad navigation when it exists. Read
`graphify-out/GRAPH_REPORT.md` only when a broad architecture review is needed
or scoped queries do not provide enough context.

Do not duplicate exhaustive file lists, symbol relationships, or call graphs in
the handoff. Include only the conceptual architecture needed to resume work and
point to Graphify for live structural detail.

After modifying code, run:

    graphify update .

This refresh is required for code changes. For a new or changed Markdown
handoff, a plain update may register the file without deeply indexing its prose.
If a semantic Markdown update command exists, it may be attempted as a
best-effort operation. Do not force a graph merge if it would shrink or damage
the current graph. The handoff remains authoritative for plan status.

## Step 3 — Use Hindsight for rationale and non-obvious knowledge

Hindsight is available and must be used for decisions and lessons that should
survive beyond this document.

Before continuing an existing effort, recall relevant memories using the
feature/project topic and established tags. The new-session section of the
handoff must tell the next agent to perform the same recall.

Retain atomic memories for:

- non-obvious architectural decisions;
- rejected alternatives and why they were rejected;
- debugging lessons and production gotchas;
- constraints that are not obvious from the diff;
- behavior that future agents must preserve;
- a pointer to the new handoff document's repository path.

Do not copy the full rationale or every debugging detail into the handoff. Keep
the handoff self-sufficient for resuming the plan, while Hindsight stores the
deeper rationale. Use project and feature-slug tags consistently.

For substantial features, consider creating a Hindsight mental model describing
the feature's architecture and current status.

## Step 4 — Match the repository's documentation convention

Inspect existing planning and handoff documents before inventing a format. Look
for directories such as `docs/plans/`, `docs/`, `doc/`, `plans/`, and
`handoffs/`. Read one or two representative files completely and match their
heading style, tone, metadata, filename convention, and section order.

If no convention exists, create:

    docs/plans/YYYY-MM-DD-feature-slug.md

Create the directory if needed. Do not overwrite existing documentation without
reading it first.

## Step 5 — Write the handoff

The document must contain the following substance. Adapt heading names and
ordering to local convention, but do not omit the substance.

### 1. Metadata

Include, when known: feature name, project, issue/plan identifier, version,
date, branch, pull request, and one-line overall status. Never invent values.

### 2. Status at a Glance

Place a skimmable table near the top. It must list every phase and major
deferred item, its exact status, and a pointer to detailed sections. Include a
clear `Ready for next phase?` statement with blockers or dependencies.

### 3. For a New Session or Agent Picking This Up

Explain that this is the durable source of truth and that the original
conversation may be unavailable. Include these startup actions:

1. Read this document completely.
2. Run `graphify query` or `graphify explain` for the feature.
3. Call Hindsight `recall` for the feature and project tags.
4. Check `git status`, recent commits, and runtime state.
5. Confirm that the status table still matches reality.
6. Re-run relevant verification commands before modifying code.

Also include these completion actions:

1. Update the status table and phase details.
2. Retain new non-obvious decisions and gotchas to Hindsight.
3. Run `graphify update .` after code changes.
4. Add a change-log entry.

### 4. Business objective and context

Explain the problem, affected users/systems, operational value, constraints,
desired outcome, and conceptual solution. A stranger must understand why the
work exists.

### 5. Decisions already taken

Record settled architecture, API, schema, migration, security, compatibility,
performance, rollout, and scope decisions. Include decisions that changed
during planning and briefly explain why. Mark these as decisions not to
re-litigate without new evidence.

### 6. Architecture and domain model

Describe the conceptual entities, data flow, request/event flow, persistence,
background processing, system boundaries, external services, security
boundaries, failure handling, retries, and deployment implications. Keep this
section conceptual and point to Graphify for exhaustive relationships.

### 7. Per-phase detail

For a completed phase, include an `As Built` subsection with what shipped,
exact files/migrations/endpoints where useful, and verification evidence.

For a partial phase, itemize every completed and incomplete sub-step. Explain
why each incomplete item matters.

For an unstarted phase, restate enough detail to execute without the original
conversation: exact files or directories, interfaces/endpoints, patterns to
follow, dependencies, acceptance criteria, tests, migration requirements, and
rollout concerns.

### 8. Explicitly deferred

Separate intentionally postponed work from work that is merely not started.
Record why it was deferred, whether it blocks current work, and what event
should trigger revisiting it.

### 9. Files touched so far

Provide a flat orientation list. State that it is not a substitute for reading
the diff or running Graphify.

### 10. Verification commands and results

Record exact test, lint, type-check, build, migration, schema, API, browser,
deployment, and manual runtime commands that were actually run. Record failures,
environmental limitations, and commands that were not run. Never imply that an
unexecuted check passed.

### 11. Change log

Add one entry per session or meaningful update, using the repository's preferred
date and ordering convention.

## Step 6 — Quality gate

Before finishing, verify:

- every original phase is accounted for;
- partial work is itemized rather than vaguely described;
- every done claim has evidence;
- deferred, not-started, and blocked work are distinguished;
- business context and architecture are understandable without the conversation;
- the next agent can identify its next concrete action;
- verification commands and results are honest;
- the status table agrees with every phase section;
- the document is saved in the repository's durable documentation location;
- Hindsight was recalled and updated where relevant;
- Graphify was queried and refreshed where relevant;
- the change log was updated.

The work is complete only when a new agent can start productively without asking
what has already been built or why the solution was designed that way.
```

## Default document template

When no local convention exists, use:

```markdown
# <Feature Name> — Developer Handoff

> **Project:** <project>  
> **Plan/Issue:** <identifier or Unknown>  
> **Version:** <version>  
> **Date:** <YYYY-MM-DD>  
> **Branch:** `<branch>`  
> **PR:** <link or None>  
> **Status:** <one-line summary>

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| Phase 1 — <name> | Done | §5 |
| Phase 2 — <name> | Partially done | §6 |
| Phase 3 — <name> | Not started | §7 |
| <major item> | Deferred | §8 |

**Ready for next phase?** <Yes/No, with reason.>

## 1. For a New Session or Agent Picking This Up

<Graphify queries, Hindsight recall instructions, repository checks, and update rules.>

## 2. Business Objective and Context

### Problem

<Why this work exists.>

### Solution

<Conceptual approach.>

## 3. Decisions Already Taken

- <Decision and rationale.>

## 4. Architecture

<Conceptual architecture and domain model.>

## 5. Phase 1 — <Name> — Done

### As Built

- <Verified completed work.>

### Verification

```bash
<exact commands>
```

## 6. Phase 2 — <Name> — Partially Done

- [x] <Completed and verified item.>
- [ ] <Incomplete item and why it matters.>

## 7. Phase 3 — <Name> — Not Started

<Specific implementation instructions and acceptance criteria.>

## 8. Explicitly Deferred

- <Deferred item, reason, and revisit trigger.>

## 9. Files Touched So Far

- `<path>`

## 10. Verification Commands

```bash
<commands and results>
```

## 11. Change Log

- **<date>** — <summary>
```
