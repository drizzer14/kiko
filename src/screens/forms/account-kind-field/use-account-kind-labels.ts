import type { AccountRow } from '@kiko/db';
import { useTranslation } from 'react-i18next';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';

// The account kinds the kind field offers, derived from `accountKindSymbol` — a
// `Record<AccountKind, string>` typed over the FULL `accounts.kind` schema
// union (see entity-symbols.ts's own exhaustiveness doc comment) — rather than
// a hand-copied array, so a later schema widening is a compile error there
// until every map built over the kinds accounts for the new one.
export const accountKinds = Object.keys(accountKindSymbol) as AccountRow['kind'][];

type AccountKindTexts = Record<AccountRow['kind'], string>;

// The display text of each account kind in the sheet, shared by the two forms
// that show the kind field (the account form and the implicit holding form), so
// the labels and subtitles stay one set. Built per render so it follows the
// active language; the field itself still reports the underlying kind.
export const useAccountKindLabels = (): {
  labels: AccountKindTexts;
  subtitles: AccountKindTexts;
} => {
  const { t } = useTranslation();

  return {
    labels: {
      bank: t('forms.account.bank'),
      cash: t('forms.account.cash'),
      crypto: t('forms.account.crypto'),
      property: t('forms.account.property'),
      metals: t('forms.account.metals'),
      debt: t('forms.account.debt'),
      broker: t('forms.account.broker'),
    },
    // The one-line "which kind is this?" hint shown under each row (a bare
    // label does not say what belongs there) — see `forms.account.kindSubtitle`.
    subtitles: {
      bank: t('forms.account.kindSubtitle.bank'),
      cash: t('forms.account.kindSubtitle.cash'),
      crypto: t('forms.account.kindSubtitle.crypto'),
      property: t('forms.account.kindSubtitle.property'),
      metals: t('forms.account.kindSubtitle.metals'),
      debt: t('forms.account.kindSubtitle.debt'),
      broker: t('forms.account.kindSubtitle.broker'),
    },
  };
};
