import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import type { MetalUnit } from '@kiko/holdings/holding-metadata';

// The short unit shown after a metal quantity. Shared by the create form's
// first-lot quantity and the Lot form's, so the two can never disagree.
export const metalUnitSuffix = (t: TFunction, unit: MetalUnit): string =>
  match(unit)
    .with('g', () => t('forms.units.grams'))
    .with('oz', () => t('forms.units.troyOunces'))
    .exhaustive();
