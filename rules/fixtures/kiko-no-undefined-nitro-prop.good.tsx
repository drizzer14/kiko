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
