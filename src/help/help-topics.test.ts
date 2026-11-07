import ts from 'typescript';
import { join } from 'node:path';
import { en, uk } from '@kiko/i18n/locales';
import { readdirSync, readFileSync } from 'node:fs';
import { TITLE_KEYS } from '@kiko/i18n/locales/title-keys';
import { flattenCatalog } from '@kiko/i18n/locales/flatten-catalog';

import { HELP_GROUPS, HELP_TOPICS, helpTopicById } from './help-topics';

const SOURCE_ROOT = join(__dirname, '..');

const catalogPaths = new Set(flattenCatalog(en).map(({ path }) => path));

const stepKeysInCatalog = (topicId: string): string[] =>
  [...catalogPaths].filter((path) => path.startsWith(`help.topics.${topicId}.steps.`));

// The Home FAB's glyph and Binance's own API-key permission label are quoted literals, not
// catalogue strings: no Kiko screen shows either.
const QUOTED_LITERALS = new Set(['+', 'Enable Reading']);

const valueByPath = (catalogue: unknown): Map<string, string> =>
  new Map(flattenCatalog(catalogue).map(({ path, value }) => [path, value]));

// The catalogue leaves a step may quote. The help topics are left out so a step cannot vouch for
// its own quote.
const leavesOutsideHelp = (catalogue: unknown): Array<{ path: string; value: string }> =>
  flattenCatalog(catalogue).filter(({ path }) => !path.startsWith('help.topics.'));

const labelsOf = (catalogue: unknown): Set<string> =>
  new Set(leavesOutsideHelp(catalogue).map(({ value }) => value));

const quotedSpans = (text: string, quote: RegExp): string[] =>
  [...text.matchAll(quote)].map(([, inner]) => inner);

// A prop that only a screen reader reads: a button with no text of its own is named through one.
const ACCESSIBILITY_PROP =
  /^(accessibilityLabel|accessibilityHint|[a-z]\w*Accessibility(Label|Hint))$/;

type KeyUse = 'accessibility' | 'visible';

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) && !/\.(test\.tsx?|d\.ts)$/.test(entry.name) ? [path] : [];
  });

const isBoundary = (node: ts.Node): boolean =>
  ts.isJsxElement(node) ||
  ts.isJsxSelfClosingElement(node) ||
  ts.isJsxFragment(node) ||
  ts.isBlock(node) ||
  ts.isSourceFile(node);

// The nearest prop or object property a key literal sits in decides how it is used; a literal
// that reaches a child of JSX, a block, or the file first is shown as text.
const usageAbove = (node: ts.Node | undefined): KeyUse => {
  if (node === undefined || isBoundary(node)) {
    return 'visible';
  }

  if (ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) {
    return ACCESSIBILITY_PROP.test(node.name.getText()) ? 'accessibility' : 'visible';
  }

  return usageAbove(node.parent);
};

const keyLiterals = (node: ts.Node, keys: ReadonlySet<string>): ts.StringLiteralLike[] => {
  const nested = node.getChildren().flatMap((child) => keyLiterals(child, keys));

  return ts.isStringLiteralLike(node) && keys.has(node.text) ? [node, ...nested] : nested;
};

// Stryker's instrumentation keeps the original literal inside `stryMutAct_x("n") ? "" :
// (stryCov_x("n"), 'key')`, so reading the literal and walking up from it works on the
// instrumented copy of a file as well as on the pristine source.
const keyUses = (
  fileName: string,
  text: string,
  keys: ReadonlySet<string>,
): Array<[string, KeyUse]> =>
  keyLiterals(
    ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    keys,
  ).map((literal) => [literal.text, usageAbove(literal.parent)]);

// A key is accessibility-only when some prop names it and nothing else uses it. A key a table or
// a variable holds, or that a Text shows, is visible, so a key used only dynamically is not seen.
const accessibilityOnlyKeys = (uses: ReadonlyArray<[string, KeyUse]>): Set<string> => {
  const visible = new Set(uses.filter(([, use]) => use === 'visible').map(([key]) => key));

  return new Set(
    uses.filter(([key, use]) => use === 'accessibility' && !visible.has(key)).map(([key]) => key),
  );
};

const catalogueKeys = new Set(leavesOutsideHelp(en).map(({ path }) => path));

const appAccessibilityOnlyKeys = accessibilityOnlyKeys(
  sourceFiles(SOURCE_ROOT).flatMap((file) =>
    // nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(reads a key literal; Stryker keeps it)
    keyUses(file, readFileSync(file, 'utf8'), catalogueKeys),
  ),
);

// Every value that no visible text renders: each catalogue key holding it is accessibility-only.
const accessibilityOnlyLabels = (catalogue: unknown): Set<string> => {
  const leaves = leavesOutsideHelp(catalogue);
  const shown = new Set(
    leaves.filter(({ path }) => !appAccessibilityOnlyKeys.has(path)).map(({ value }) => value),
  );

  return new Set(leaves.map(({ value }) => value).filter((value) => !shown.has(value)));
};

describe('help topic registry', () => {
  it('has unique topic ids', () => {
    expect(new Set(HELP_TOPICS.map(({ id }) => id)).size).toBe(HELP_TOPICS.length);
  });

  it.each(HELP_TOPICS)('has every string of $id in the en catalogue', (topic) => {
    expect(topic.stepKeys.length).toBeGreaterThan(0);

    for (const key of [topic.titleKey, topic.rowLabelKey, ...topic.stepKeys]) {
      expect(catalogPaths.has(key)).toBe(true);
    }
  });

  it.each(HELP_TOPICS)('has the title of $id in TITLE_KEYS', (topic) => {
    expect(TITLE_KEYS.has(topic.titleKey)).toBe(true);
  });

  it.each(HELP_TOPICS)('lists every step of $id that the catalogue holds, in order', (topic) => {
    expect(topic.stepKeys).toEqual(stepKeysInCatalog(topic.id));
    expect(topic.stepKeys).toEqual(
      topic.stepKeys.map((_, index) => `help.topics.${topic.id}.steps.${index + 1}`),
    );
  });

  it.each([
    ['addAccount', 5],
    ['connectMonobank', 5],
    ['connectCrypto', 5],
    ['importStatement', 6],
    ['setReminder', 4],
    ['addHolding', 5],
    ['trackProperty', 5],
    ['trackLoan', 6],
    ['addTransaction', 4],
    ['editTransaction', 3],
    ['useTemplates', 4],
    ['manageCategories', 5],
    ['categoryRules', 6],
    ['viewStatistics', 12],
    ['viewRecurringCharges', 5],
    ['backupData', 4],
    ['restoreData', 4],
    ['systemSettings', 5],
  ] as const)('gives the %s topic %i steps', (topicId, count) => {
    expect(helpTopicById(topicId).stepKeys).toHaveLength(count);
  });

  it.each([
    ['addAccount', 'addAccount'],
    ['connectMonobank', 'addBankAccount'],
    ['connectCrypto', 'addCryptoAccount'],
    ['importStatement', null],
    ['setReminder', 'openReminders'],
    ['addHolding', null],
    ['trackProperty', 'addProperty'],
    ['trackLoan', 'addLoan'],
    ['addTransaction', 'addTransaction'],
    ['editTransaction', null],
    ['useTemplates', 'openTemplates'],
    ['manageCategories', 'openCategories'],
    ['categoryRules', 'openCategories'],
    ['viewStatistics', 'openStatistics'],
    ['viewRecurringCharges', 'openRecurringCharges'],
    ['backupData', 'openExportData'],
    ['restoreData', 'openImportData'],
    ['systemSettings', 'openSystem'],
  ] as const)('gives the %s topic the %s action', (topicId, action) => {
    expect(helpTopicById(topicId)).toMatchObject({ id: topicId, action });
  });
});

describe('help group registry', () => {
  it('lists the groups in order, each with its topics in order', () => {
    expect(HELP_GROUPS.map((group) => [group.id, group.topics.map((topic) => topic.id)])).toEqual([
      [
        'accounts',
        ['addAccount', 'connectMonobank', 'connectCrypto', 'importStatement', 'setReminder'],
      ],
      ['holdings', ['addHolding', 'trackProperty', 'trackLoan']],
      ['transactions', ['addTransaction', 'editTransaction', 'useTemplates']],
      ['categories', ['manageCategories', 'categoryRules']],
      ['statistics', ['viewStatistics']],
      ['settings', ['viewRecurringCharges', 'backupData', 'restoreData', 'systemSettings']],
    ]);
    expect(HELP_TOPICS).toHaveLength(18);
  });

  it('puts every topic in exactly one group', () => {
    const grouped = HELP_GROUPS.flatMap((group) => group.topics);

    expect(grouped).toHaveLength(HELP_TOPICS.length);
    expect(new Set(grouped)).toEqual(new Set(HELP_TOPICS));
  });

  it.each(HELP_GROUPS)('has at least one topic in the $id group', (group) => {
    expect(group.topics.length).toBeGreaterThan(0);
  });

  it.each(HELP_GROUPS)(
    'has the title of the $id group in the catalogue and TITLE_KEYS',
    (group) => {
      expect(catalogPaths.has(group.titleKey)).toBe(true);
      expect(TITLE_KEYS.has(group.titleKey)).toBe(true);
    },
  );

  it('has unique group ids', () => {
    expect(new Set(HELP_GROUPS.map(({ id }) => id)).size).toBe(HELP_GROUPS.length);
  });
});

describe('the labels a help step quotes', () => {
  const enValues = valueByPath(en);
  const ukValues = valueByPath(uk);
  const enLabels = labelsOf(en);
  const ukLabels = labelsOf(uk);
  const enSpokenOnly = accessibilityOnlyLabels(en);
  const ukSpokenOnly = accessibilityOnlyLabels(uk);

  it('reads a quoted label out of a step', () => {
    expect(quotedSpans('Tap "Save", then "+".', /"([^"]*)"/g)).toEqual(['Save', '+']);
    expect(quotedSpans('Натисніть «Зберегти».', /«([^»]*)»/g)).toEqual(['Зберегти']);
  });

  it.each(HELP_TOPICS)('quotes only en catalogue strings in the $id steps', (topic) => {
    const unknown = topic.stepKeys
      .flatMap((key) => quotedSpans(enValues.get(key) ?? '', /"([^"]*)"/g))
      .filter((span) => !(enLabels.has(span) || QUOTED_LITERALS.has(span)));

    expect(unknown).toEqual([]);
  });

  it.each(HELP_TOPICS)('quotes only uk catalogue strings in the $id steps', (topic) => {
    const unknown = topic.stepKeys
      .flatMap((key) => quotedSpans(ukValues.get(key) ?? '', /«([^»]*)»/g))
      .filter((span) => !(ukLabels.has(span) || QUOTED_LITERALS.has(span)));

    expect(unknown).toEqual([]);
  });

  it.each(HELP_TOPICS)(
    'quotes no label that only an accessibility prop renders in the $id steps',
    (topic) => {
      const spokenOnly = [
        [enSpokenOnly, enValues, /"([^"]*)"/g],
        [ukSpokenOnly, ukValues, /«([^»]*)»/g],
      ] as const;

      const quoted = spokenOnly.flatMap(([labels, values, quote]) =>
        topic.stepKeys
          .flatMap((key) => quotedSpans(values.get(key) ?? '', quote))
          .filter((span) => labels.has(span)),
      );

      expect(quoted).toEqual([]);
    },
  );

  it('finds the labels that only an accessibility prop renders', () => {
    expect(enSpokenOnly).toContain(enValues.get('settings.dataImport.pasteKey'));
    expect(ukSpokenOnly).toContain(ukValues.get('settings.dataImport.pasteKey'));
    expect(enSpokenOnly).not.toContain(enValues.get('common.save'));
    expect(enSpokenOnly).not.toContain(enValues.get('settings.dataImport.keyLabel'));
  });

  it('finds the quoted labels of the steps at all', () => {
    const quoted = HELP_TOPICS.flatMap((topic) =>
      topic.stepKeys.flatMap((key) => quotedSpans(enValues.get(key) ?? '', /"([^"]*)"/g)),
    );

    expect(quoted.length).toBeGreaterThan(50);
    expect(quoted).toContain('Export Data');
  });
});

describe('reading how a catalogue key is used in source', () => {
  const usesIn = (source: string): Array<[string, KeyUse]> =>
    keyUses('fixture.tsx', source, new Set(['a.key']));

  it.each([
    ['an accessibilityLabel prop', `<Pressable accessibilityLabel={t('a.key')} />`],
    ['an accessibilityHint prop', `<Pressable accessibilityHint={t('a.key')} />`],
    ['a prop named for what it labels', `<Field pasteAccessibilityLabel={t('a.key')} />`],
    ['an accessibility property of an object', `const item = { accessibilityLabel: t('a.key') };`],
    [
      'a key literal inside the instrumented shape',
      `<Pressable accessibilityLabel={t(stryMutAct_9fa48("1") ? "" : (stryCov_9fa48("1"), 'a.key'))} />`,
    ],
  ])('reads %s as accessibility', (_name, source) => {
    expect(usesIn(source)).toEqual([['a.key', 'accessibility']]);
  });

  it.each([
    ['the text of a Text', `<Text>{t('a.key')}</Text>`],
    ['another prop', `<Button title={t('a.key')} />`],
    ['a table of keys', `const labels = { label: 'a.key' };`],
    ['a Text inside an accessibility prop', `<A accessibilityHint={<Text>{t('a.key')}</Text>} />`],
    [
      'a Text that its parent labels',
      `<Pressable accessibilityLabel="x"><Text>{t('a.key')}</Text></Pressable>`,
    ],
  ])('reads %s as visible', (_name, source) => {
    expect(usesIn(source)).toEqual([['a.key', 'visible']]);
  });

  it('counts a key that something else also shows as visible', () => {
    expect(
      accessibilityOnlyKeys([
        ['read.key', 'accessibility'],
        ['both.key', 'accessibility'],
        ['both.key', 'visible'],
        ['shown.key', 'visible'],
      ]),
    ).toEqual(new Set(['read.key']));
  });
});

describe('the choices a help step names', () => {
  const enValues = valueByPath(en);
  const ukValues = valueByPath(uk);
  const stepOf = (values: Map<string, string>, id: string, step: number): string =>
    values.get(`help.topics.${id}.steps.${step}`) ?? '';

  it('names the choices the sheet of a new transaction shows, never the edit-only one', () => {
    for (const [values, quote] of [
      [enValues, /"([^"]*)"/g],
      [ukValues, /«([^»]*)»/g],
    ] as const) {
      expect(quotedSpans(stepOf(values, 'addTransaction', 4), quote)).toEqual(
        ['common.save', 'forms.transaction.apply', 'common.cancel'].map(
          (path) => values.get(path) ?? '',
        ),
      );
    }
  });

  it.each([
    ['en', enValues, /"([^"]*)"/g, en.statistics.title, en.home.title],
    ['uk', ukValues, /«([^»]*)»/g, uk.statistics.title, uk.home.title],
  ] as const)(
    'names only the Statistics tab, with no iPad window or Home tab, in step 1 of the viewStatistics topic in %s',
    (_language, values, quote, statisticsTab, homeTab) => {
      const step = stepOf(values, 'viewStatistics', 1);
      const quoted = quotedSpans(step, quote);

      expect(quoted).toContain(statisticsTab);
      expect(quoted).not.toContain(homeTab);
      expect(step).not.toMatch(/iPad/);
    },
  );

  it.each([
    [
      'en',
      enValues,
      /"([^"]*)"/g,
      [
        en.statistics.netWorthOverTime,
        en.statistics.byType,
        en.statistics.accountContribution,
        en.statistics.expensesByCategory,
        en.statistics.spendingTrendByCategory,
      ],
    ],
    [
      'uk',
      ukValues,
      /«([^»]*)»/g,
      [
        uk.statistics.netWorthOverTime,
        uk.statistics.byType,
        uk.statistics.accountContribution,
        uk.statistics.expensesByCategory,
        uk.statistics.spendingTrendByCategory,
      ],
    ],
  ] as const)(
    'opens steps 2 to 6 of the viewStatistics topic with the card titles in the order of the one-column layout in %s',
    (_language, values, quote, titles) => {
      const firstQuoted = [2, 3, 4, 5, 6].map(
        (step) => quotedSpans(stepOf(values, 'viewStatistics', step), quote)[0],
      );

      expect(firstQuoted).toEqual(titles);
    },
  );

  it.each([
    [
      'en',
      enValues,
      'Transfers between your own accounts and wallets, currency exchanges, and cash withdrawals from your bank do not count as spending.',
    ],
    [
      'uk',
      ukValues,
      'Перекази між власними рахунками й гаманцями, обміни валют і зняття готівки в банку не вважаються витратами.',
    ],
  ] as const)(
    'names the wallets among the own-money moves that are not spending in %s',
    (_language, values, sentence) => {
      expect(stepOf(values, 'viewStatistics', 7)).toContain(sentence);
    },
  );

  it.each([
    [
      'en',
      enValues,
      /by 1\b/,
      'first month with data',
      'differ slightly',
      'mean of the cells',
      'A return that falls in a different month from its payment lowers the "Total" or "All" figure, but not the cell of the payment\'s month.',
    ],
    [
      'uk',
      ukValues,
      /на 1\b/,
      'перший місяць із даними',
      'трохи відрізнятися',
      'середнє значення клітинок',
      'Повернення, що припадає на інший місяць, ніж платіж, зменшує значення «Разом» або «Усього», але не клітинку місяця платежу.',
    ],
  ] as const)(
    'claims in %s no bound on how far a table total can sit from its cells, names the first month the average leaves out, and says what a return in another month changes',
    (_language, values, bound, firstMonth, falseClaim, averageIsCells, returnSentence) => {
      const step = stepOf(values, 'viewStatistics', 9);

      expect(step).not.toMatch(bound);
      expect(step).not.toContain(falseClaim);
      expect(step).toContain(firstMonth);
      expect(step).toContain(averageIsCells);
      expect(step).toContain(returnSentence);
    },
  );

  // The step names where the button is, so it must follow the screen: first, above the filters.
  it.each([
    ['en', enValues, 'Above the filters', 'Below the filters'],
    ['uk', ukValues, 'Над фільтрами', 'Під фільтрами'],
  ] as const)(
    'places the Monthly tables button in %s above the filters',
    (_language, values, above, below) => {
      const step = stepOf(values, 'viewStatistics', 9);

      expect(step.startsWith(above)).toBe(true);
      expect(step).not.toContain(below);
    },
  );

  it.each([
    [
      'en',
      enValues,
      'money you withdraw or sell from Binance to your bank',
      'exchange rates',
      'revaluation',
    ],
    [
      'uk',
      ukValues,
      'гроші, які ви виводите чи продаєте з Binance на ваш банківський рахунок',
      'курси валют',
      'переоцінка',
    ],
  ] as const)(
    'names in %s the Binance money that counts as income and why net is not the net worth change',
    (_language, values, binanceMoney, rates, revaluation) => {
      const step = stepOf(values, 'viewStatistics', 10);

      expect(step).toContain(binanceMoney);
      expect(step).toContain(rates);
      expect(step).toContain(revaluation);
    },
  );

  it.each([
    [
      'en',
      enValues,
      [
        'more than 2 minutes apart or only one side was synced',
        'a transfer from one of your Monobank cards that Kiko syncs or synced',
        'a category you pick with "Categories" narrows the category table only',
      ],
      'are the figures of the category table',
    ],
    [
      'uk',
      ukValues,
      [
        'понад 2 хвилини або синхронізовано лише одну',
        'переказ з вашої картки Monobank, яку синхронізує або синхронізував Кіко',
        'звужує лише таблицю за категоріями',
      ],
      'це дані таблиці за категоріями',
    ],
  ] as const)(
    'names in %s the own transfers and the synced Monobank card credit that income can get wrong, and a category pick that narrows only the category table',
    (_language, values, wrongRows, falseClaim) => {
      const step = stepOf(values, 'viewStatistics', 10);

      for (const wrongRow of wrongRows) {
        expect(step).toContain(wrongRow);
      }

      expect(step).not.toContain(falseClaim);
    },
  );

  it('words the refund credit of step 10 in uk without the change-return word and with the bank account in full', () => {
    const step = stepOf(ukValues, 'viewStatistics', 10);

    expect(step).not.toContain('Повернення коштів');
    expect(step).not.toContain('рахується');
    expect(step).not.toContain('на ваш банк ');
    expect(step).not.toContain('Binance на банк,');
    expect(step).toContain(
      'Кошти, які продавець повернув окремим зарахуванням, вважаються надходженням',
    );
    expect(step).toContain('на ваш банківський рахунок');
  });

  // The control has three parts, so step 10 may not say it switches between two tables.
  it.each([
    ['en', enValues, 'switch between the two tables', 'switch between the three tables'],
    ['uk', ukValues, 'перемикати «Категорії» та «Рух коштів».', 'і «Капітал».'],
  ] as const)(
    'says in %s that the control at the top of Tables switches between three tables',
    (_language, values, falseClaim, trueClaim) => {
      const step = stepOf(values, 'viewStatistics', 10);

      expect(step).not.toContain(falseClaim);
      expect(step).toContain(trueClaim);
    },
  );

  it.each([
    [
      'en',
      enValues,
      /"([^"]*)"/g,
      [
        en.tables.view.netWorth,
        en.tables.all,
        en.statistics.netWorthOverTime,
        en.tables.netWorth.change,
      ],
      ['an archived account is not counted', "A currency with no history uses today's rate"],
      'has no category filter',
    ],
    [
      'uk',
      ukValues,
      /«([^»]*)»/g,
      [
        uk.tables.view.netWorth,
        uk.tables.all,
        uk.statistics.netWorthOverTime,
        uk.tables.netWorth.change,
      ],
      ['архівований рахунок не враховується', 'Валюта без історії береться за сьогоднішнім курсом'],
      'немає фільтра за категоріями',
    ],
  ] as const)(
    'names in %s the labels of the net worth table, its rate rule and that it has no category filter',
    (_language, values, quote, labels, claims, noCategoryFilter) => {
      const step = stepOf(values, 'viewStatistics', 11);

      expect(quotedSpans(step, quote)).toEqual(expect.arrayContaining([...labels]));

      for (const claim of claims) {
        expect(step).toContain(claim);
      }

      expect(step).toContain(noCategoryFilter);
    },
  );

  it('names the main currency in uk step 11 and says which table has no category filter', () => {
    const step = stepOf(ukValues, 'viewStatistics', 11);

    expect(step).not.toContain('базов');
    expect(step).toContain('у цілих одиницях основної валюти');
    expect(step).toContain('У таблиці «Капітал» немає фільтра за категоріями.');
  });

  it.each([
    ['en', enValues, /"([^"]*)"/g, en.tables, 'newest first'],
    ['uk', ukValues, /«([^»]*)»/g, uk.tables, 'від найновіших'],
  ] as const)(
    'names in %s, in step 12, the cells that list the transactions behind them and the ones that have no list',
    (_language, values, quote, tables, newestFirst) => {
      const step = stepOf(values, 'viewStatistics', 12);

      expect(quotedSpans(step, quote)).toEqual([
        tables.view.categories,
        tables.total,
        tables.all,
        tables.view.cashFlow,
        tables.cashFlow.income,
        tables.cashFlow.expenses,
        tables.average,
        tables.cashFlow.net,
        tables.cashFlow.savingsRate,
        tables.view.netWorth,
      ]);
      expect(step).toContain(newestFirst);
    },
  );

  it.each([
    ['en', enValues, /\bonly\b/i, 'Loan interest'],
    ['uk', ukValues, /лише/i, 'Відсотки за кредитом'],
  ] as const)(
    'does not claim in %s that only the interest of a linked loan payment counts',
    (_language, values, exclusive, interestLabel) => {
      const step = stepOf(values, 'viewStatistics', 7);

      expect(step).not.toMatch(exclusive);
      expect(step).toContain(interestLabel);
    },
  );
});

describe('the Binance key the connectCrypto help topic asks for', () => {
  it.each([
    ['en', valueByPath(en), 'Enable Reading', 'no trading or withdrawal permission'],
    ['uk', valueByPath(uk), 'Enable Reading', 'без дозволів на торгівлю й виведення'],
  ] as const)(
    'asks in %s for a key with only reading turned on, never a trading or withdrawal one',
    (_language, values, readingLabel, noTradingPhrase) => {
      const step = values.get('help.topics.connectCrypto.steps.3') ?? '';

      expect(step).toContain(readingLabel);
      expect(step).toContain(noTradingPhrase);
    },
  );
});

describe('the Ukrainian wording of the help topics', () => {
  const ukValues = valueByPath(uk);
  const stepValues = HELP_TOPICS.flatMap((topic) =>
    topic.stepKeys.map((key) => ({ key, value: ukValues.get(key) ?? '' })),
  );

  const TOPIC_TITLES = [
    ['addAccount', 'Додавання рахунку'],
    ['connectMonobank', 'Підключення Monobank'],
    ['connectCrypto', 'Підключення Binance або гаманця Bitcoin'],
    ['importStatement', 'Імпорт банківської виписки'],
    ['setReminder', 'Налаштування нагадування'],
    ['addHolding', 'Додавання активу'],
    ['trackProperty', 'Облік майна'],
    ['trackLoan', 'Облік кредиту'],
    ['addTransaction', 'Додавання транзакції'],
    ['editTransaction', 'Редагування, дублювання чи видалення транзакції'],
    ['useTemplates', 'Шаблони транзакцій'],
    ['manageCategories', 'Керування категоріями'],
    ['categoryRules', 'Автоматичні категорії'],
    ['viewStatistics', 'Перегляд статистики'],
    ['viewRecurringCharges', 'Перегляд регулярних платежів'],
    ['backupData', 'Резервна копія даних'],
    ['restoreData', 'Відновлення з резервної копії'],
    ['systemSettings', 'Мова, вигляд і блокування застосунку'],
  ] as const;

  it('asks for most taps in the steps with the verb "натиснути"', () => {
    expect(stepValues.filter(({ value }) => /натисн/i.test(value)).length).toBeGreaterThan(30);
  });

  it('covers every help topic in the title table', () => {
    expect(TOPIC_TITLES.map(([topicId]) => topicId)).toEqual(HELP_TOPICS.map(({ id }) => id));
  });

  it.each(TOPIC_TITLES)(
    'titles the %s topic «%s» and labels its row the same',
    (topicId, title) => {
      const topic = helpTopicById(topicId);

      expect(ukValues.get(topic.titleKey)).toBe(title);
      expect(ukValues.get(topic.rowLabelKey)).toBe(title);
    },
  );

  it.each([
    ['importStatement', 5, 'рядок із назвами'],
    ['categoryRules', 1, 'натисніть «Категорії», а потім потрібну категорію'],
    ['systemSettings', 3, 'У розділі «Вигляд» оберіть «Системний», «Світлий» або «Темний»'],
  ] as const)('words the %s topic step %i with «%s»', (topicId, step, wording) => {
    expect(ukValues.get(`help.topics.${topicId}.steps.${step}`)).toContain(wording);
  });
});
