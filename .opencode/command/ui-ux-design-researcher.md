---
description: Launch the UI/UX Design Researcher subagent to produce design specs.
agent: ui-ux-design-researcher
---

Research and produce a detailed UI/UX design specification for: $ARGUMENTS

Follow the execution workflow strictly:
1. Read relevant current codebase screens and styles to understand existing patterns
2. Web search for modern UI/UX patterns, Material Design 3, and iOS HIG guidelines
3. Conceptualize layouts, user flows, transitions, and state logic
4. Write a Markdown file in /scratch/ containing:
   - User Journey and Flow Diagram (Mermaid or text-based)
   - Component Layout Wireframe (ASCII or detailed description)
   - Visual design tokens (Tailwind CSS v4 classes for web, StyleSheet rules for mobile)
   - Micro-interactions, animations, and haptic instructions
   - Accessibility checklist (contrast, screen reader labels, keyboard focus)
5. Return the path to the written spec file
