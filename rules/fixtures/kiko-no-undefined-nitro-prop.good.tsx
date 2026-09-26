import { SFSymbolView } from 'react-native-nitro-sfsymbols';

import { effectiveFallbackName } from '../../src/design-system/components/symbol/symbol.availability';

// Semgrep fixture (NEGATIVE): a string literal, or a value routed through
// `effectiveFallbackName` (the same guard `symbol.component.tsx` uses,
// which never returns `undefined`), never reaches native `null` —
// `kiko-no-undefined-nitro-prop` MUST report nothing here.

export const literalFallback = <SFSymbolView name="star" fallbackName="star.fill" />;

export const guardedFallback = (name: string, fallbackName: string | undefined) => {
  const resolvedFallback = effectiveFallbackName(name, fallbackName);

  return <SFSymbolView name={name} fallbackName={resolvedFallback} />;
};

// A local re-declared under the SAME name as the prop it replaces, still
// routed through `effectiveFallbackName` first — the bare pass-through arm
// must not flag this local just because its own name is the literal
// identifier `fallbackName`; it is not a raw, unguarded pass-through. A
// top-level `const` (not a function's `return`), so this does not read as a
// second component-like export under kiko-code-style's "One component per
// file", the same reason `literalFallback` above is written this way.
declare const incomingFallback: string | undefined;
const fallbackName = effectiveFallbackName('star', incomingFallback);

export const guardedFallbackSameName = <SFSymbolView name="star" fallbackName={fallbackName} />;
