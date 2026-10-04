import { SFSymbolView } from 'react-native-nitro-sfsymbols';

// A string-returning resolver, declared so the fixture imports nothing; Semgrep matches the JSX either way.
declare const resolveFallback: (name: string, fallbackName: string | undefined) => string;

// Semgrep fixture (NEGATIVE): a string literal, the symbol's own name (what
// `symbol.component.tsx` passes), or a value from a resolver that returns a
// string never reaches native `null` —
// `kiko-no-undefined-nitro-prop` MUST report nothing here.

export const literalFallback = <SFSymbolView name="star" fallbackName="star.fill" />;

declare const symbolName: string;

export const ownNameFallback = <SFSymbolView name={symbolName} fallbackName={symbolName} />;

export const guardedFallback = (name: string, fallbackName: string | undefined) => {
  const resolvedFallback = resolveFallback(name, fallbackName);

  return <SFSymbolView name={name} fallbackName={resolvedFallback} />;
};

// A local re-declared under the SAME name as the prop it replaces, still
// routed through `resolveFallback` first — the bare pass-through arm
// must not flag this local just because its own name is the literal
// identifier `fallbackName`; it is not a raw, unguarded pass-through. The
// safe-local exclusion is scoped to the ENCLOSING function/arrow body (see
// `rules/semgrep-prewrite.yml`'s comment on this rule), so the reassignment
// has to live inside a function here rather than at the top level. The
// wrapper is a NON-exported function (`resolveGuardedFallbackSameName`), so
// it does not read as a second component-like export under kiko-code-style's
// "One component per file" — only its call result is exported, as a plain
// top-level const, the same reason `literalFallback` above is written that
// way.
declare const incomingFallback: string | undefined;

function resolveGuardedFallbackSameName() {
  const fallbackName = resolveFallback('star', incomingFallback);

  return <SFSymbolView name="star" fallbackName={fallbackName} />;
}

export const guardedFallbackSameName = resolveGuardedFallbackSameName();
