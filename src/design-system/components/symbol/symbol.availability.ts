// The fallback SF Symbol to actually hand the native view's `fallbackName`
// prop: the caller's explicit fallback, else the symbol's OWN name. The final
// `?? name` is load-bearing, not cosmetic: `SymbolIcon` renders ONE persistent
// native `<SFSymbolView>` per call site (e.g. the transaction-type select
// trigger), so a prop change across renders is a Fabric UPDATE, not a fresh
// mount, and an updated prop that becomes `undefined` serializes to native
// `null`. The native Nitro binding for `fallbackName` requires a `String` and
// throws on `null` — crashing the app in Release (no redbox to catch it there).
// Always returning a string here, never `undefined`, keeps `fallbackName` a
// STABLE string across every update so it can never hit that native null path.
// Every symbol the app draws exists on the deployment target (the Jest guard
// `__tests__/symbol-deployment-target.test.tsx` enforces it), so no per-symbol
// swap is needed.
export const effectiveFallbackName = (name: string, fallbackName: string | undefined): string =>
  fallbackName ?? name;
