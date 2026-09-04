---
description: Review the current diff for over-engineering and report what can be cut.
---
<!-- VENDORED from ponytail 4.9.0 (commands/ponytail-review.toml). Source: https://github.com/DietrichGebert/ponytail
     Only this review prompt is vendored. No ponytail hooks are registered. Only the reviewer agent uses it. -->

Review the diff below for over-engineering. Report only what can be cut. Do not comment on correctness here.

First, get the diff:
```bash
git diff
```

Tag each finding with exactly one tag:
- delete — dead code or a speculative feature that is not needed now.
- stdlib — reinvents something the standard library already provides.
- native — a dependency does what the platform already does.
- yagni — an abstraction with only one implementation.
- shrink — the same logic written in fewer lines.

Output one line per finding, in this exact form:
L<line>: <tag> <what to cut>. <replacement>.

End with the net number of removable lines. If there is nothing to cut, write exactly:
Lean already. Ship.
