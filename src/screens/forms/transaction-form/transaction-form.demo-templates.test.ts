import {
  decryptEnvelope,
  decodeBase64ToBytes,
  type ExportEnvelope,
  type ExportPayload,
} from '@kiko/data-transfer';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { TransactionTemplateRow } from '@kiko/db';
import { isTemplateDraft } from '@kiko/transaction-templates/draft';

import { resolveHydration } from './hydration';
import { resolveTemplateSeed } from './template-references';

// The App Store reviewer opens the demo `.kiko` through the real Import UI and the Templates list
// names each template's mode, so the form a template opens must be that mode with every stored
// reference seated: a template whose holding cannot be its mode's payer opens a plain expense and
// the reviewer never reaches the mode (Guideline 5.6). The committed files are read, not the
// dataset builder, because `src/screens` may not import the `e2e/` tree.
const DEMO_KEY = join(__dirname, '../../../../e2e/screenshot/fixtures/kiko-demo.key');

const decryptDemo = (envelopeJson: string): ExportPayload['tables'] => {
  const key = decodeBase64ToBytes(readFileSync(DEMO_KEY, 'utf8'));
  const envelope: ExportEnvelope = JSON.parse(envelopeJson);
  const payload: ExportPayload = JSON.parse(
    new TextDecoder().decode(decryptEnvelope(envelope, key)),
  );

  return payload.tables;
};

const DEMO_ENVELOPES = {
  en: readFileSync(
    join(__dirname, '../../../../e2e/screenshot/fixtures/kiko-demo-en.kiko'),
    'utf8',
  ),
  uk: readFileSync(
    join(__dirname, '../../../../e2e/screenshot/fixtures/kiko-demo-uk.kiko'),
    'utf8',
  ),
};

describe.each(['uk', 'en'] as const)('the %s demo templates, filled into the form', (language) => {
  const {
    accounts,
    categories,
    holdings,
    transactionTemplates = [],
  } = decryptDemo(DEMO_ENVELOPES[language]);
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const source = {
    holdings,
    accountNameById: new Map(accounts.map((account) => [account.id, account.name])),
    accountOrderById: new Map(accounts.map((account, index) => [account.id, index])),
    accountById: new Map(accounts.map((account) => [account.id, account])),
    categoryKeys: categories.map((category) => category.key),
  };

  const fill = (row: TransactionTemplateRow) => {
    const { templateDraft } = resolveTemplateSeed({
      row,
      isReady: true,
      isHydrated: false,
      carriesName: false,
      source,
    });
    const args = {
      existing: undefined,
      duplicateSource: undefined,
      holding: undefined,
      primaryHoldingId: null,
      currency: 'UAH' as const,
      defaultPrimaryHoldingId: null,
      blankLabel: null,
      templateDraft,
      templateName: null,
      pageHolding: undefined,
      holdings,
    };
    const seating = resolveHydration(args);
    const plan =
      seating.kind === 'seedHolding'
        ? resolveHydration({
            ...args,
            primaryHoldingId: seating.holdingId,
            holding: holdingById.get(seating.holdingId),
          })
        : seating;

    return { templateDraft, plan };
  };

  it.each(transactionTemplates.map((row) => [row.name, row] as const))(
    'fills %s in its own mode with every reference seated',
    (_name, row) => {
      const stored = row.draft;
      const { templateDraft, plan } = fill(row);

      expect(isTemplateDraft(stored)).toBe(true);
      expect(templateDraft).toEqual(stored);

      if (plan.kind !== 'seedFields' || !isTemplateDraft(stored)) {
        throw new Error('the template did not fill');
      }

      expect(plan.mode).toBe(stored.mode);
      expect(plan.destinationHoldingId).toBe(stored.exchange?.destinationHoldingId ?? null);
      expect(plan.returns.map((returnRow) => returnRow.holdingId)).toEqual(
        stored.returns.length === 0
          ? [null]
          : stored.returns.map((returnRow) => returnRow.holdingId),
      );
      expect(plan.valueIn !== '').toBe(stored.exchange !== null);
    },
  );
});
