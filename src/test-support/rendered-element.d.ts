import type { within } from '@testing-library/react-native';

/**
 * The element type every RNTL query returns.
 *
 * WHY THIS EXISTS: RNTL 14 renamed its element type to `TestInstance` and
 * re-exports it from neither its own entry point nor a package this app
 * declares — `import type { ReactTestInstance } from '@testing-library/react-native'`
 * is a TS2305, and importing from the transitive `test-renderer` would be an
 * undeclared dependency. Deriving it from `within`'s own parameter keeps the
 * alias correct across RNTL upgrades with no extra dependency.
 *
 * Its `props` is an index signature (`Record<string, any>`), which does NOT
 * satisfy a hand-written `{ props: { style: unknown } }` — a helper that
 * inspects a node's style must take this type, not a narrower literal.
 */
export type RenderedElement = Parameters<typeof within>[0];
