import { match } from 'ts-pattern';
import { isLiquidGlassSupported } from '@callstack/liquid-glass';

import type { FooterGlassBackingProps } from './footer-glass-backing.props';

// The variant a Button draws on `FooterGlassBacking`, or undefined when it keeps its normal fill:
// outside a floating footer, or for `ghost`, which has no fill to put on glass. A solid variant
// also keeps its fill below iOS 26 (no Liquid Glass), where it is already opaque; a tonal one
// does not, because its translucent tint would let the rows under the footer show through, so it
// takes the backing's opaque base there.
export const resolveFooterGlassVariant = (
  variant: FooterGlassBackingProps['variant'] | 'ghost',
  isInFloatingFooter: boolean,
): FooterGlassBackingProps['variant'] | undefined =>
  match(variant)
    .with('ghost', () => undefined)
    .with('primary', 'secondary', 'destructive', (solidVariant) =>
      isInFloatingFooter && isLiquidGlassSupported ? solidVariant : undefined,
    )
    .with('secondaryTonal', 'destructiveTonal', (tonalVariant) =>
      isInFloatingFooter ? tonalVariant : undefined,
    )
    .exhaustive();
