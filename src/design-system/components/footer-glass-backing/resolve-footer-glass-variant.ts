import { match } from 'ts-pattern';
import { isLiquidGlassSupported } from '@callstack/liquid-glass';

import type { FooterGlassBackingProps } from './footer-glass-backing.props';

// The variant a Button draws on `FooterGlassBacking`, or undefined when it keeps its normal fill:
// outside a floating footer, below iOS 26 (no Liquid Glass), or for `ghost`, which has no fill to
// put on glass.
export const resolveFooterGlassVariant = (
  variant: FooterGlassBackingProps['variant'] | 'ghost',
  isInFloatingFooter: boolean,
): FooterGlassBackingProps['variant'] | undefined =>
  match(variant)
    .with('ghost', () => undefined)
    .with(
      'primary',
      'secondary',
      'destructive',
      'secondaryTonal',
      'destructiveTonal',
      (filledVariant) => (isInFloatingFooter && isLiquidGlassSupported ? filledVariant : undefined),
    )
    .exhaustive();
