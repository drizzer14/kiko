import { Platform } from 'react-native';

// The SF Symbols this app renders that were introduced in iOS 26 (SF Symbols
// 7). `SFSymbolView` renders a symbol the running OS cannot resolve as a BLANK
// glyph, and the app floor is iOS 16, so each MUST fall back to an iOS-16-safe
// glyph on an older device. Centralized here — NOT duplicated per call site —
// so no consumer of `SymbolIcon` can render one of these without its fallback
// (e.g. the transaction-type ChipRow's `split` chip, which passes only a plain
// name string, still gets `arrow.branch` on an older device for free).
export const IOS26_SYMBOL_FALLBACKS: Record<string, string> = {
  'arrow.trianglehead.2.clockwise.rotate.90': 'arrow.triangle.2.circlepath',
  'text.pad.header': 'list.bullet.rectangle',
  'arrow.trianglehead.branch': 'arrow.branch',
};

// The iOS major version that introduced every symbol in the map above.
const IOS26_MAJOR = 26;

// The running device's iOS major version. `Platform.Version` is a string like
// `"16.4"` on iOS; `parseInt` yields the major. Kept a function so the pure
// `resolveSymbolName` below can be unit-tested hermetically with an explicit
// `osMajor` rather than mocking `Platform`.
export const currentOsMajor = (): number => Number.parseInt(String(Platform.Version), 10);

// The fallback SF Symbol to actually hand the native view's `fallbackName`
// prop: the caller's explicit fallback, else the central iOS-26 mapping, else
// the symbol's OWN name. This is the RUNTIME net — the native side
// substitutes it for any name the OS cannot resolve, covering symbols whose
// minimum iOS is unverified (§3.0.5). The final `?? name` fallback is load-
// bearing, not cosmetic: `SymbolIcon` renders ONE persistent native
// `<SFSymbolView>` per call site (e.g. the transaction-type select trigger),
// so a prop change across renders is a Fabric UPDATE, not a fresh mount, and
// an updated prop that becomes `undefined` serializes to native `null`. The
// native Nitro binding for `fallbackName` requires a `String` and throws on
// `null` — crashing the app in Release (no redbox to catch it there). Always
// returning a string here, never `undefined`, keeps `fallbackName` a STABLE
// string across every update so it can never hit that native null path.
export const effectiveFallbackName = (name: string, fallbackName: string | undefined): string =>
  fallbackName ?? IOS26_SYMBOL_FALLBACKS[name] ?? name;

// Resolve the SF Symbol name to render. For one of the KNOWN iOS-26 symbols on
// a device below iOS 26, the fallback (explicit, else central-map) is returned
// so the glyph never paints blank — a DETERMINISTIC guarantee independent of
// whether the native `fallbackName` net triggers on this device. Every other
// symbol is returned unchanged (its minimum iOS is unknown in JS, so it defers
// to the native `fallbackName` net instead).
export const resolveSymbolName = (
  name: string,
  fallbackName: string | undefined,
  osMajor: number,
): string => {
  const fallback = effectiveFallbackName(name, fallbackName);

  if (name in IOS26_SYMBOL_FALLBACKS && osMajor < IOS26_MAJOR) {
    return fallback;
  }

  return name;
};
