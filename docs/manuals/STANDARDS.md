# Forson Business Suite — User Manual Standards

This document defines how every manual page in `docs/manuals/` must be written. It exists so that
40+ module pages, written across many sessions/agents, read as one coherent product — not as a pile
of independently-styled notes. Every module manual must follow `TEMPLATE.md`, which implements these
standards structurally.

Audience: **end users** (cashiers, accounting staff, HR staff, managers) — not developers. A future
developer-facing technical layer may be added later, but it is a separate document, never mixed into
these pages (see "No hybrid docs" below).

## Core principles

1. **Task-oriented, not feature-oriented.** Organize around what the user is trying to accomplish
   ("Record a customer payment") not around UI structure or internal module names. A section list
   should read like a table of jobs-to-be-done, not a menu tree.

2. **Progressive disclosure.** Order every page: one-line purpose → step-by-step procedure → field
   reference → edge cases/troubleshooting. A reader must be able to stop reading as soon as their
   need is met.

3. **Rigid structural consistency.** Every module page uses the exact section headings and order
   defined in `TEMPLATE.md`. Do not rename, reorder, or skip sections — write "N/A" or omit the
   content under an empty section header rather than deleting the header, so the shape stays
   predictable across all pages.

4. **Plain, active, second-person voice.** "Click **Save**." Not "The Save button is clicked" or
   "Users may click Save." Avoid nominalizations and passive voice throughout.

5. **Terminology locked to the UI.** Use the exact label text shown on screen (button text, field
   labels, status names), verbatim, every time — never a paraphrase or synonym. If the UI says
   "Post," the manual never says "submit" or "confirm."

6. **Concrete, worked examples over abstract description.** Use realistic sample data (e.g.
   `INV-2026-000123`, `₱1,120.00`) in every walkthrough, not placeholders like `<amount>`.

7. **Failure modes are first-class content.** Every page must document the common validation
   errors / blocked states a user will hit, what they mean, and what to do next. A manual that
   only documents the happy path is incomplete.

8. **No hybrid docs.** Keep implementation detail (formulas, DB fields, API/internal names) out of
   the main body. If a module genuinely needs that depth for power users (e.g. reconciliation
   formulas), it goes in the page's optional **Advanced Reference** section at the bottom, clearly
   separated, and must still be written for a numerate business user — not a developer.

9. **Builds autonomy, not dependency.** Explain the *purpose* of a task, not just the clicks — a
   staffer who understands why a step exists can handle a situation the manual didn't literally spell
   out; one who was only given a script cannot. Reserve exact, no-deviation steps for places where
   precision genuinely matters (financial postings, tax fields, anything that hits the ledger).
   Elsewhere, describe the goal and the normal path, and trust the reader to use judgment — do not
   pad procedures with instructions for self-evident UI actions ("move your mouse to the top-right
   corner and click the blue button"). Call out explicitly, in the task's opening line, when a step
   must be followed exactly vs. when it's a default that can flex.

10. **New-hire friendly.** Assume zero institutional/tribal knowledge — a new hire's first day, not a
    veteran's refresher. Define every business term the first time it's used (see Key Concepts). Give
    each task a sentence of orientation — where it sits in the bigger workflow and why it matters —
    before the steps, so a newcomer isn't just pattern-matching clicks without knowing what they're
    for. This is also what makes the manual useful to an experienced user skimming for one detail:
    context up front means they can stop reading the moment they have what they need.

11. **Traceable.** Every page's frontmatter records the app area/version it was verified against and
   the date. This is what lets us detect staleness later instead of guessing.

12. **Show the math when it aids understanding.** If a number on screen is computed from other
    numbers (totals, taxes, reconciliation figures, prorated amounts, etc.), state the plain-language
    formula in the main body — not just the result. This is core to the HOW and WHY, not an
    implementation detail: "Net Sales = Gross Sales − Refunds" belongs next to the field it explains.
    Write it as simple arithmetic with a worked number, the way you'd explain it to a coworker on a
    whiteboard — never as set notation, LaTeX, or summation symbols; that formal/edge-case version, if
    needed at all, belongs in **Advanced Reference**, kept separate so it doesn't intimidate the
    primary reader. Rule of thumb: if a manager or accountant needs the formula to trust or audit the
    number, it's main-body; if only an engineer debugging the system needs it, it's Advanced Reference.

13. **Reads like a consumer product manual, not an internal spec.** Aim for the feel of a manual that
    ships in a product box: welcoming, confident, easy to flip through — not a dry internal spec.
    Concretely:
    - Every module page opens with an **At a Glance** box (2-4 lines: what it's for, who it's for,
      the 1-2 things you'll do here most often) — the equivalent of a quick-start card, so a reader
      can tell in five seconds if this is the page they need.
    - Use three consistent callout types, sparingly, instead of burying asides in paragraphs:
      `> 💡 Tip` (a shortcut or best practice), `> 📝 Note` (a clarifying aside), `> ⚠️ Important`
      (something that causes real trouble if missed, e.g. anything hitting the ledger).
    - Troubleshooting is written reassuringly, not as a bare error log — lead with "Here's what this
      means and what to do," not just the message text. The reader should never feel like they broke
      something irreversible when they haven't.
    - Warm but efficient — friendly framing, never padding. This is additive to voice principle #4,
      not a license to write filler.

14. **Single source of truth.** These granular per-module files are the only place manual content is
    authored. The combined/printable manual and any future in-app tooltips are generated *from* these
    files — never edited independently. Do not hand-copy content into a second location.

## File naming and location

- One file per module, in `docs/manuals/`, named `snake_case_module_name.md` matching the page it
  documents (e.g. `sales_history_manual.md` for `SalesHistoryPage.jsx`).
- Cross-links between manuals use relative markdown links, e.g. `[Accounts Receivable](./accounts_receivable_manual.md)`.

## Review bar before a module page is considered done

- [ ] Follows `TEMPLATE.md` section-for-section
- [ ] Every procedure has been checked against the actual current UI (not written from memory/assumption)
- [ ] Every button/field/status name matches on-screen text exactly
- [ ] At least one worked example with realistic data per major workflow
- [ ] Each task states why it matters and whether steps are exact-required or a flexible default
- [ ] No unnecessary micromanagement of self-evident UI actions; terms are defined for a new hire
- [ ] Every derived/computed figure has a plain-arithmetic formula with a worked number, in the main body
- [ ] Has an At a Glance box; callouts (if any) use the Tip/Note/Important convention; troubleshooting reads reassuringly
- [ ] Common errors section is populated, not left as a stub
- [ ] No developer-only detail (DB columns, API routes, internal function names) in the main body
- [ ] Frontmatter dated and versioned
