# Universal `plan-to-docs` Skill — Standalone Edition

Use the following prompt to establish a reusable `plan-to-docs` skill in an agent environment where Graphify, Hindsight, and equivalent external memory/indexing tools are not available.

```text
# Establish and Use the `plan-to-docs` Skill

Create or adopt a skill named `plan-to-docs`. Its purpose is to produce a
durable, repository-checked-in handoff document for any multi-phase plan or
implementation. A new agent must be able to read the document cold, without the
original conversation, and know what was built, what remains, why decisions were
made, and how to continue.

This skill is fully self-contained. It must not assume Graphify, Hindsight,
cloud memory, semantic indexing, or any external knowledge service exists.
Use repository files, version control, local documentation, tests, runtime
inspection, and explicit prose instead.

## Activation conditions

Use this skill when:

- the user asks for a plan or developer handoff document;
- a multi-phase effort is paused, handed off, deprioritized, or completed;
- another agent must continue work without the current conversation;
- a substantial feature needs durable implementation status and rationale.

Do not use it for a trivial change unless documentation is explicitly requested.

## Core rule: document reality, not intentions

Every status statement must be based on repository or runtime evidence. Do not
trust memory, an old plan, or another agent's claim without checking.

Classify every phase as exactly one of:

- Done
- Partially done
- Not started
- Deferred

For every phase that is not completely finished, list individual sub-steps:

    - [x] Added and verified the database migration.
    - [x] Added the API behavior and success-path tests.
    - [ ] Authorization is not implemented yet.
    - [ ] Timeout and retry behavior still needs coverage.

Never write only `Phase 2 — partially done`. Explain the exact boundary between
completed and incomplete work.

Distinguish implemented, committed, tested, manually inspected, deployed, and
not verified. A file existing is not proof that its behavior works.

## Step 1 — Establish repository ground truth

Run the project's equivalents of:

    git status --short
    git log --oneline -20
    git branch --show-current
    git diff <base-branch>...HEAD --stat
    git diff

Inspect the original plan, issue, ticket, design document, or planning file if
available. Treat it as the original intent, not evidence of completion.

Inspect durable artifacts directly when relevant:

- source files;
- database migrations and schema;
- API routes and services;
- frontend components;
- tests;
- generated files;
- configuration;
- workers and queues;
- infrastructure and deployment manifests;
- external integration adapters.

When necessary, inspect the running system using safe read-only checks, API
smoke tests, schema status commands, logs, or application health endpoints.

Map every planned phase to evidence. If the original plan cannot be found,
reconstruct it from the conversation, issue, commits, diffs, and source, and
state that the original plan was unavailable.

## Step 2 — Navigate without external graph or memory tools

Use local tools instead of assuming an architectural index exists:

- `rg` for symbols, routes, feature names, and configuration;
- `rg --files` for repository navigation;
- `find` for documentation and migration directories;
- `git log -S`, `git log --grep`, and `git blame` for history and rationale;
- local README, architecture, runbook, and design documents;
- test files to identify expected behavior;
- dependency manifests to identify integration boundaries.

Use commands such as:

    rg -n "<feature|symbol|route>" .
    rg --files | sort
    git log --all --oneline -- <path>
    git log -S"<important text>" --oneline -- <path>
    git blame <path>

Do not claim to have queried Graphify or retrieved Hindsight memories. Instead,
write important architectural relationships, decisions, gotchas, and rationale
directly into the handoff so it remains useful without external services.

## Step 3 — Match the project's documentation convention

Inspect existing documentation before inventing a format. Look for:

- `docs/plans/`;
- `docs/`;
- `doc/`;
- `plans/`;
- `handoffs/`;
- PRDs, design docs, runbooks, or developer handoffs.

Read one or two representative documents completely. Match their structure,
tone, metadata, heading style, naming convention, and section ordering.

If no convention exists, create:

    docs/plans/YYYY-MM-DD-feature-slug.md

Create the directory if necessary. Do not overwrite an existing document without
reading it first.

## Step 4 — Write the durable handoff

The document must include the following substance, even if local heading names
are different.

### 1. Metadata

Include when known: feature name, project, plan or issue identifier, version,
date, branch, pull request, and one-line overall status. Never invent missing
values.

### 2. Status at a Glance

Put a concise table near the top. List every phase and major deferred item with
its exact status and a pointer to detailed sections. Include a clear statement
of whether work is ready for the next phase and identify blockers.

### 3. For a New Session or Agent Picking This Up

Tell the next agent:

1. Read the document fully before editing code.
2. Check `git status`, recent commits, current branch, and relevant runtime
   state.
3. Re-run the verification commands before trusting the status.
4. Search the current repository because file paths and implementation details
   may have changed.
5. Compare the status table with current repository reality.
6. Update this document whenever a phase is completed or a decision changes.
7. Record important rationale and gotchas in the document itself because no
   external memory system is assumed.

### 4. Business objective and context

Explain the original problem, affected users or systems, operational value,
constraints, desired outcome, and conceptual solution. The reader must
understand why the work exists before touching the implementation.

### 5. Decisions already taken

Record settled decisions about architecture, APIs, schemas, migrations,
security, compatibility, performance, rollout, and scope. Include alternatives
that were rejected and decisions that changed during planning. Briefly explain
why the final decision was chosen.

Because no Hindsight system is available, include enough rationale here to
prevent a future agent from accidentally re-litigating or reversing a settled
decision.

### 6. Architecture and domain model

Describe the conceptual solution:

- important entities and ownership;
- request and event flows;
- persistence and data lifecycle;
- background jobs and retries;
- system and service boundaries;
- external integrations;
- security boundaries;
- failure behavior;
- deployment and rollback implications.

Do not paste the entire repository structure or every function relationship.
Use focused prose and link to relevant files, tests, and local documentation.

### 7. Per-phase detail

For a completed phase, include an `As Built` section covering what shipped,
which files/migrations/endpoints matter, how it behaves, and how it was
verified.

For a partial phase, use explicit checkboxes for every completed and incomplete
sub-step. Explain the consequence of each incomplete item.

For an unstarted phase, restate enough detail to execute without the original
conversation: exact files or directories, interfaces/endpoints, patterns to
follow, dependencies, acceptance criteria, tests, migration requirements, and
rollout concerns.

### 8. Explicitly deferred work

Separate deliberately postponed scope from work that is simply not started.
For every deferred item, record why it was deferred, whether it blocks current
work, and what future condition should trigger revisiting it.

### 9. Files touched so far

Provide a flat orientation list. The list is not a substitute for reading the
diff or inspecting current files.

### 10. Verification commands and results

Record exact commands that were actually run: tests, lint, type checking,
builds, migrations, schema checks, API smoke tests, browser tests, deployment
checks, and manual runtime checks. Record failures, skipped checks, and
environment limitations honestly.

### 11. Change log

Add one entry per session or meaningful update, following the project's normal
date and ordering convention.

## Step 5 — Preserve rationale locally

Since no external memory service is assumed, include directly in the handoff:

- non-obvious architectural reasoning;
- rejected alternatives;
- debugging discoveries;
- production or environment gotchas;
- compatibility constraints;
- dangerous assumptions;
- known failure modes;
- instructions that future agents must preserve.

Keep the details focused on decisions that are not obvious from the diff. Do not
turn the document into a line-by-line code explanation.

Use links to repository files, tests, commits, issues, and runbooks where useful.
Prefer durable repository references over links to temporary chat messages.

## Step 6 — Update safely

When updating an existing handoff:

1. Read it fully.
2. Re-establish current ground truth.
3. Preserve useful historical context.
4. Correct stale status claims.
5. Never silently turn unfinished work into completed work.
6. Do not erase deferred decisions or verification failures without explaining
   the change.
7. Update the status table and matching phase sections together.
8. Record the update in the change log.
9. Re-check every command and path that the next agent is expected to use.

## Step 7 — Quality gate

Before finishing, verify:

- every original phase is accounted for;
- partial work is itemized precisely;
- every done claim has evidence;
- deferred, not-started, and blocked work are distinct;
- business context is understandable without the conversation;
- architecture and important decisions are documented;
- the next agent has a concrete next action;
- rationale and gotchas are present locally;
- verification commands and results are honest;
- the status table agrees with all phase sections;
- the document is saved in the durable repository documentation location;
- the change log is updated.

The document is complete only when a fresh agent can continue without asking
what has already been built or why it was designed that way.
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

<Repository checks, local search instructions, and update rules.>

## 2. Business Objective and Context

### Problem

<Why this work exists.>

### Solution

<Conceptual approach.>

## 3. Decisions Already Taken

- <Decision, alternatives, and rationale.>

## 4. Architecture

<Conceptual architecture and domain model.>

## 5. Phase 1 — <Name> — Done

### As Built

- <Verified completed work.>

### Verification

```bash
<exact commands and results>
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
