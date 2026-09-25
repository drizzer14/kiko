// Ambient types for `windows-1251` (Sensebank CSV's cp1251 decoder;
// also the FOP CSV formats' decoder). The package ships real types
// (`node_modules/windows-1251/windows-1251.d.ts`) AND a `"types"` field in
// its `package.json`, but its `"exports"` map has no `"types"` CONDITION —
// only `"exports": "./windows-1251.mjs"` — so under this project's
// `"moduleResolution": "bundler"` (tsconfig, via
// `@react-native/typescript-config`), TypeScript refuses to fall back to the
// root `"types"` field once an `"exports"` map is present at all (TS7016:
// "this result could not be resolved when respecting package.json
// 'exports'"). This mirrors the library's own shipped `.d.ts` verbatim
// (`encode`/`decode`/`labels`) — no functionality invented, just re-declared
// locally so the real import typechecks.
declare module 'windows-1251' {
  type EncodeOptions = {
    mode: 'fatal' | 'replacement';
  };
  type DecodeOptions = {
    mode: 'fatal' | 'replacement';
  };

  export function encode(text: string, options?: EncodeOptions): Uint16Array;
  export function decode(
    buffer: Uint16Array | Uint8Array | Buffer | string,
    options?: DecodeOptions,
  ): string;
  export const labels: string[];
}
