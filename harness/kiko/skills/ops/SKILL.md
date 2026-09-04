---
name: ops
description: Use when running Kiko builds, installs, pods, or the harness checks.
---

Run project commands and report results.

Rules:
- Report the exact command, its output, and the result.
- Use the check scripts from plan #2: check:lint, check:all, check:deep.
- Do not write app code. Hand code changes to the developer.
