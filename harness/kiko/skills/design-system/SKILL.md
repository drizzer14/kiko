---
name: design-system
description: Use when the designer defines or changes theme tokens, colors, spacing, typography, or shared components.
---

Keep one source of truth for Kiko styles.

Rules:
- Define tokens in a single theme module. Components read tokens; they do not hardcode values.
- When a Figma file is provided, ask the coordinator to turn the figma plugin on, because it is
  off in this project; then use the figma plugin skills to pull the design.
- The developer consumes the design system. The designer owns it.
