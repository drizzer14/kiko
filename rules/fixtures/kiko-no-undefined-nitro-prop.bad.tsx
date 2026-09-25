import { SFSymbolView } from 'react-native-nitro-sfsymbols';

// Semgrep fixture (POSITIVE): the Nitro `SFSymbolView.fallbackName` prop is
// a plain native `String` — passing `undefined` (directly, via `??`, via a
// ternary, or via a bare optional-prop pass-through) serializes to native
// `null` and crashes the app in Release, with no redbox to catch it there
// (see `symbol.availability.ts`'s own doc comment on
// `effectiveFallbackName`). `kiko-no-undefined-nitro-prop` MUST report a
// finding on each pinned line below. Every input is a top-level `declare
// const` (never a function parameter) so no export here reads as a
// component (`return`/`=>` into JSX) under kiko-code-style's "One component
// per file" — this fixture proves only ITS OWN rule, no other.
declare const hasFallback: boolean;
declare const missingFallback: boolean;
declare const fallback: string;
declare const name: string;
declare const fallbackName: string | undefined;

// EXPECT-FINDING
export const literalUndefined = <SFSymbolView name="star" fallbackName={undefined} />;

// EXPECT-FINDING
export const nullishCoalesceToUndefined = (
  <SFSymbolView name="star" fallbackName={fallback ?? undefined} />
);

// EXPECT-FINDING
export const ternaryUndefinedOnElse = (
  <SFSymbolView name="star" fallbackName={hasFallback ? fallback : undefined} />
);

// EXPECT-FINDING
export const ternaryUndefinedOnThen = (
  <SFSymbolView name="star" fallbackName={missingFallback ? undefined : fallback} />
);

// EXPECT-FINDING
export const barePassThrough = <SFSymbolView name={name} fallbackName={fallbackName} />;
