import { Platform } from 'react-native';

type SymbolFallback = {
  // The `major.minor` iOS that introduced the symbol, as the SF Symbols
  // catalogue records it (`__tests__/symbol-fallbacks.test.tsx` checks it).
  minimumIos: string;
  // A symbol that exists on iOS 15.1, the deployment target.
  fallback: string;
};

// Every SF Symbol the app can draw that is newer than the iOS 15.1 deployment
// target. `SFSymbolView` renders a symbol the running OS cannot resolve as a
// BLANK glyph, so each one MUST swap to its iOS-15.1-safe fallback on an older
// device. Centralized here, NOT duplicated per call site, so no consumer of
// `SymbolIcon` can draw one of these without its fallback (e.g. the
// transaction-type ChipRow's `split` chip passes only a plain name string and
// still gets its fallback on an older device for free). The user-selectable
// icon pools keep the ORIGINAL name in storage; only the drawn glyph changes.
// A new symbol newer than iOS 15.1 needs an entry, which the Jest guard
// enforces for every symbol it can collect from a module.
export const SYMBOL_FALLBACKS: Record<string, SymbolFallback> = {
  'arrow.trianglehead.2.clockwise.rotate.90': {
    minimumIos: '18.0',
    fallback: 'arrow.triangle.2.circlepath',
  },
  'arrow.trianglehead.branch': { minimumIos: '18.0', fallback: 'arrow.triangle.branch' },
  australiandollarsign: { minimumIos: '17.0', fallback: 'dollarsign.circle' },
  australsign: { minimumIos: '16.0', fallback: 'australsign.circle' },
  bahtsign: { minimumIos: '16.0', fallback: 'bahtsign.circle' },
  basket: { minimumIos: '16.0', fallback: 'cart' },
  bird: { minimumIos: '16.0', fallback: 'ladybug' },
  bitcoinsign: { minimumIos: '16.0', fallback: 'bitcoinsign.square' },
  brazilianrealsign: { minimumIos: '16.0', fallback: 'brazilianrealsign.circle' },
  'calendar.and.person': { minimumIos: '18.0', fallback: 'calendar.badge.clock' },
  cat: { minimumIos: '17.0', fallback: 'pawprint' },
  cedisign: { minimumIos: '16.0', fallback: 'cedisign.circle' },
  centsign: { minimumIos: '16.0', fallback: 'centsign.circle' },
  chineseyuanrenminbisign: { minimumIos: '17.0', fallback: 'yensign.circle' },
  coloncurrencysign: { minimumIos: '16.0', fallback: 'coloncurrencysign.circle' },
  cruzeirosign: { minimumIos: '16.0', fallback: 'cruzeirosign.circle' },
  'cup.and.heat.waves': { minimumIos: '18.0', fallback: 'cup.and.saucer.fill' },
  danishkronesign: { minimumIos: '17.0', fallback: 'banknote' },
  document: { minimumIos: '18.0', fallback: 'doc' },
  'document.on.clipboard': { minimumIos: '18.0', fallback: 'doc.on.clipboard' },
  dog: { minimumIos: '17.0', fallback: 'pawprint' },
  dollarsign: { minimumIos: '16.0', fallback: 'dollarsign.square' },
  dongsign: { minimumIos: '16.0', fallback: 'dongsign.circle' },
  dumbbell: { minimumIos: '16.0', fallback: 'figure.walk' },
  'envelope.front': { minimumIos: '18.0', fallback: 'envelope' },
  eurosign: { minimumIos: '16.0', fallback: 'eurosign.square' },
  eurozonesign: { minimumIos: '17.0', fallback: 'eurosign.circle' },
  fish: { minimumIos: '16.0', fallback: 'tortoise' },
  flask: { minimumIos: '17.0', fallback: 'testtube.2' },
  florinsign: { minimumIos: '16.0', fallback: 'florinsign.circle' },
  francsign: { minimumIos: '16.0', fallback: 'francsign.circle' },
  guaranisign: { minimumIos: '16.0', fallback: 'guaranisign.circle' },
  handbag: { minimumIos: '16.1', fallback: 'bag' },
  'hockey.puck': { minimumIos: '16.0', fallback: 'sportscourt' },
  hryvniasign: { minimumIos: '16.0', fallback: 'hryvniasign.square' },
  indianrupeesign: { minimumIos: '16.0', fallback: 'indianrupeesign.circle' },
  'key.horizontal': { minimumIos: '16.1', fallback: 'key' },
  kipsign: { minimumIos: '16.0', fallback: 'kipsign.circle' },
  larisign: { minimumIos: '16.0', fallback: 'larisign.circle' },
  lirasign: { minimumIos: '16.0', fallback: 'lirasign.circle' },
  malaysianringgitsign: { minimumIos: '18.0', fallback: 'banknote' },
  manatsign: { minimumIos: '16.0', fallback: 'manatsign.circle' },
  millsign: { minimumIos: '16.0', fallback: 'millsign.circle' },
  movieclapper: { minimumIos: '17.0', fallback: 'film' },
  nairasign: { minimumIos: '16.0', fallback: 'nairasign.circle' },
  norwegiankronesign: { minimumIos: '17.0', fallback: 'banknote' },
  'party.popper': { minimumIos: '16.0', fallback: 'sparkles' },
  peruviansolessign: { minimumIos: '18.0', fallback: 'banknote' },
  pesetasign: { minimumIos: '16.0', fallback: 'pesetasign.circle' },
  pesosign: { minimumIos: '16.0', fallback: 'pesosign.circle' },
  polishzlotysign: { minimumIos: '17.0', fallback: 'banknote' },
  popcorn: { minimumIos: '16.0', fallback: 'play.rectangle' },
  receipt: { minimumIos: '18.2', fallback: 'doc.text' },
  rupeesign: { minimumIos: '16.0', fallback: 'rupeesign.circle' },
  shekelsign: { minimumIos: '16.0', fallback: 'shekelsign.circle' },
  shoe: { minimumIos: '17.0', fallback: 'tshirt' },
  singaporedollarsign: { minimumIos: '18.0', fallback: 'dollarsign.circle' },
  smartphone: { minimumIos: '17.0', fallback: 'iphone' },
  sterlingsign: { minimumIos: '16.0', fallback: 'sterlingsign.circle' },
  stroller: { minimumIos: '16.1', fallback: 'person.2' },
  swedishkronasign: { minimumIos: '17.0', fallback: 'banknote' },
  teddybear: { minimumIos: '16.0', fallback: 'face.smiling' },
  tengesign: { minimumIos: '16.0', fallback: 'tengesign.circle' },
  tent: { minimumIos: '16.0', fallback: 'flame' },
  'text.pad.header': { minimumIos: '26.0', fallback: 'list.bullet.rectangle' },
  tugriksign: { minimumIos: '16.0', fallback: 'tugriksign.circle' },
  turkishlirasign: { minimumIos: '16.0', fallback: 'turkishlirasign.circle' },
  'wallet.bifold': { minimumIos: '18.0', fallback: 'wallet.pass' },
  wheelchair: { minimumIos: '18.0', fallback: 'figure.roll' },
  wineglass: { minimumIos: '16.0', fallback: 'takeoutbag.and.cup.and.straw' },
  wonsign: { minimumIos: '16.0', fallback: 'wonsign.circle' },
  'xmark.triangle.circle.square': { minimumIos: '18.0', fallback: 'square.on.circle' },
  yensign: { minimumIos: '16.0', fallback: 'yensign.circle' },
};

// `Object.hasOwn` keeps an inherited key (`constructor`) from reading as an
// entry, which would hand the native view a function as `fallbackName`.
const fallbackFor = (name: string): SymbolFallback | undefined =>
  Object.hasOwn(SYMBOL_FALLBACKS, name) ? SYMBOL_FALLBACKS[name] : undefined;

// `Platform.Version` is a string like `"16.4"` (or `"26.0.1"`) on iOS. The
// minor matters: 16.1 and 18.2 symbols are blank on 16.0 and 18.1, so a
// major-only gate would leave those devices without the fallback. An
// unreadable part is NaN, which compares false either way.
const versionParts = (version: string): [number, number] => {
  const [major = Number.NaN, minor = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  return [major, minor];
};

export const isOsBelow = (osVersion: string, minimumIos: string): boolean => {
  const [major, minor] = versionParts(osVersion);
  const [minimumMajor, minimumMinor] = versionParts(minimumIos);

  return major < minimumMajor || (major === minimumMajor && minor < minimumMinor);
};

// The running device's iOS version. Kept a function so the pure
// `resolveSymbolName` below can be unit-tested hermetically with an explicit
// `osVersion` rather than mocking `Platform`.
export const currentOsVersion = (): string => String(Platform.Version);

// The fallback SF Symbol to actually hand the native view's `fallbackName`
// prop: the caller's explicit fallback, else the central mapping, else the
// symbol's OWN name. This is the RUNTIME net — the native side substitutes it
// for any name the OS cannot resolve, covering symbols whose minimum iOS is
// unverified. The final `?? name` fallback is load-bearing, not cosmetic:
// `SymbolIcon` renders ONE persistent native `<SFSymbolView>` per call site
// (e.g. the transaction-type select trigger), so a prop change across renders
// is a Fabric UPDATE, not a fresh mount, and an updated prop that becomes
// `undefined` serializes to native `null`. The native Nitro binding for
// `fallbackName` requires a `String` and throws on `null` — crashing the app
// in Release (no redbox to catch it there). Always returning a string here,
// never `undefined`, keeps `fallbackName` a STABLE string across every update
// so it can never hit that native null path.
export const effectiveFallbackName = (name: string, fallbackName: string | undefined): string =>
  fallbackName ?? fallbackFor(name)?.fallback ?? name;

// Resolve the SF Symbol name to render. For a MAPPED symbol on a device older
// than its minimum iOS, the fallback (explicit, else central-map) is returned
// so the glyph never paints blank — a DETERMINISTIC guarantee independent of
// whether the native `fallbackName` net triggers on this device. Every other
// symbol is returned unchanged (its minimum iOS is unknown in JS, so it defers
// to the native `fallbackName` net instead).
export const resolveSymbolName = (
  name: string,
  fallbackName: string | undefined,
  osVersion: string,
): string => {
  const entry = fallbackFor(name);

  if (entry !== undefined && isOsBelow(osVersion, entry.minimumIos)) {
    return effectiveFallbackName(name, fallbackName);
  }

  return name;
};
