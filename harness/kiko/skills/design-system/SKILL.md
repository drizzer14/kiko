---
name: design-system
description: Use when the designer defines or changes theme tokens, colors, spacing, typography, or shared components.
---

Keep one source of truth for Kiko styles.

Rules:
- Define tokens in a single theme module. Components read tokens; they do not hardcode values.
- When a Figma file is provided, use the figma plugin skills to pull the design.
- The developer consumes the design system. The designer owns it.
