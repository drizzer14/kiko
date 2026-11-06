import { Alert } from 'react-native';
import type { ReactElement } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type {
  planReviewGroups,
  ReviewCandidate,
  StoredCategoryRule,
} from '@kiko/categories/category-rules';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoryReviewScreen from './category-review.screen';

type ReviewScreenProps = NativeStackScreenProps<SettingsStackParamList, 'CategoryReview'>;
type ReadKind = 'candidates' | 'rules' | 'categories' | 'evidence';
type EvidenceData = { description: string; categoryKey: string; rowCount: number };
type CategoryData = { key: string; title: string; icon: string; color: string | null };
type Preview = { count: number; names: string[] };
type ModalProps = { visible: boolean; onDismiss?: () => void; onRequestClose?: () => void };

const OPTIONS_SHEET = 'category-options-sheet';
const CONFIRM_SHEET = 'confirm-sheet';
const LOADING = 'category-review-loading';
const LINE = 'review-line';
const FIRST_LINE = 0;
const SECOND_LINE = 1;
const MOVE = i18n.t('categoryRulePreview.confirm');
const CANCEL = i18n.t('common.cancel');

const mockPreview = jest.fn<Promise<Preview>, [object]>();
const mockApply = jest.fn<Promise<number>, [object]>();
const mockUseIsScreenVisible = jest.fn(() => true);
const mockUseLiveQuery = jest.fn();
const mockPlanCalls = jest.fn();
const mockModalProps = new Map<string, ModalProps>();
let mockCandidates: ReviewCandidate[] = [];
let mockRules: StoredCategoryRule[] = [];
let mockCategories: CategoryData[] = [];
let mockEvidence: EvidenceData[] = [];
let mockLoading: Record<ReadKind, boolean> = {
  candidates: false,
  rules: false,
  categories: false,
  evidence: false,
};

// The shared Modal double drops a hidden sheet from the tree, and a test needs the one handler
// the native Modal calls once a sheet has finished closing, so this one keeps the latest props.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Modal = ({
    visible,
    children,
    ...rest
  }: ModalProps & { children: ReactElement; testID?: string }) => {
    if (typeof rest.testID === 'string') {
      mockModalProps.set(rest.testID, {
        visible,
        onDismiss: rest.onDismiss,
        onRequestClose: rest.onRequestClose,
      });
    }

    return visible ? React.createElement(View, rest, children) : null;
  };

  return { __esModule: true, default: Modal };
});
jest.mock('@kiko/navigation/pane-stack', () => ({
  useIsScreenVisible: () => mockUseIsScreenVisible(),
}));
jest.mock('@kiko/categories/category-rules', () => {
  const actual = jest.requireActual('@kiko/categories/category-rules') as {
    planReviewGroups: typeof planReviewGroups;
  };

  return {
    ...actual,
    planReviewGroups: (...args: Parameters<typeof planReviewGroups>) => {
      mockPlanCalls();

      return actual.planReviewGroups(...args);
    },
  };
});
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ __kind: 'categories' }) },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    allQuery: () => ({ __kind: 'rules' }),
    reviewCandidateRowsQuery: () => ({ __kind: 'candidates' }),
    reviewEvidenceQuery: () => ({ __kind: 'evidence' }),
    previewNameRule: (input: object) => mockPreview(input),
    applyNameRule: (input: object) => mockApply(input),
  },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

const navigation = navigationSpy();

const reviewElement = () => (
  <CategoryReviewScreen
    navigation={asNavigationProp<ReviewScreenProps['navigation']>(navigation)}
    route={asRouteProp<ReviewScreenProps['route']>('CategoryReview')}
  />
);

const renderReview = () => render(reviewElement());

type Screen = Awaited<ReturnType<typeof renderReview>>;

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const candidateOf = (description: string, index: number): ReviewCandidate => ({
  id: `${description}-${index}`,
  description,
  amountMinorUnits: -100,
  time: 1_000,
  currency: 'UAH',
  category: null,
  categorySetByHand: false,
  setsBalance: false,
  changeGroupId: null,
  mcc: null,
  counterIban: null,
  accountId: 'account',
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
});

const candidatesOf = (
  description: string,
  count: number,
  overrides: Partial<ReviewCandidate> = {},
): ReviewCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    ...candidateOf(description, index),
    ...overrides,
  }));

// Two groups: `ATB` holds two names (a starts-with line of 5 rows), `Silpo` holds one (2 rows).
const worldCandidates = (): ReviewCandidate[] => [
  ...candidatesOf('ATB 0212', 3),
  ...candidatesOf('ATB 0340', 2),
  ...candidatesOf('Silpo', 2),
];

const ATB_ROWS = 5;
const SILPO_ROWS = 2;
const NAMES = ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Name 5', 'Name 6', 'Name 7'];

const dataOf = (kind: ReadKind): unknown[] =>
  ({
    candidates: mockCandidates,
    rules: mockRules,
    categories: mockCategories,
    evidence: mockEvidence,
  })[kind];

const linesOf = (screen: Screen) => screen.getAllByTestId(LINE);

const pressChoose = async (screen: Screen, lineIndex: number): Promise<void> => {
  await fireEvent.press(
    within(linesOf(screen)[lineIndex]).getByText(i18n.t('categoryReview.choose')),
  );
};

const pressOption = async (screen: Screen, title: string): Promise<void> => {
  await fireEvent.press(within(screen.getByTestId(OPTIONS_SHEET)).getByText(title));
};

const closeSheet = async (sheetTestId: string): Promise<void> => {
  await act(async () => {
    mockModalProps.get(`${sheetTestId}-modal`)?.onDismiss?.();
  });
};

// The way a user picks: the line's button, the option, then the sheet finishing its close.
const pick = async (screen: Screen, lineIndex: number, title = 'Groceries'): Promise<void> => {
  await pressChoose(screen, lineIndex);
  await pressOption(screen, title);
  await closeSheet(OPTIONS_SHEET);
};

const pressMove = async (screen: Screen): Promise<void> => {
  await fireEvent.press(within(screen.getByTestId(CONFIRM_SHEET)).getByText(MOVE));
};

const previewReturns = (count: number, names: string[] = NAMES.slice(0, 2)): void => {
  mockPreview.mockResolvedValue({ count, names });
};

const deferredWrite = () => {
  let resolve: (changed: number) => void = () => {};
  const promise = new Promise<number>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const textsOf = (node: ReturnType<Screen['getByTestId']>): string[] =>
  within(node)
    .queryAllByText(/./)
    .map((text) => JSON.stringify(text.props.children));

const groceriesPayload = (name: string, kind: string) => ({
  name,
  kind,
  category: 'groceries',
  sourceTransactionId: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockModalProps.clear();
  mockUseIsScreenVisible.mockReturnValue(true);
  mockCandidates = worldCandidates();
  mockRules = [];
  mockCategories = SEEDED_CATEGORIES.map((category) => ({ ...category, color: null }));
  mockEvidence = [];
  mockLoading = { candidates: false, rules: false, categories: false, evidence: false };
  mockApply.mockResolvedValue(0);
  previewReturns(ATB_ROWS);
  mockUseLiveQuery.mockImplementation((query: { __kind: ReadKind }) => ({
    data: dataOf(query.__kind),
    isLoading: mockLoading[query.__kind],
    isFresh: true,
  }));
});

describe('CategoryReviewScreen', () => {
  describe('loading and the empty state', () => {
    const READS: ReadKind[] = ['candidates', 'rules', 'categories', 'evidence'];

    it.each(READS)(
      'shows the loading state while the %s read is on its first load',
      async (read) => {
        mockLoading = { ...mockLoading, [read]: true };
        mockCandidates = [];

        const screen = await renderReview();

        expect(screen.getByTestId(LOADING)).toBeTruthy();
        expect(screen.queryAllByTestId(LINE)).toHaveLength(0);
      },
    );

    it.each(READS)('never the empty state then: the %s read is on its first load', async (read) => {
      mockLoading = { ...mockLoading, [read]: true };
      mockCandidates = [];

      const screen = await renderReview();

      expect(screen.queryByText(i18n.t('categoryReview.emptyTitle'))).toBeNull();
      expect(screen.queryByText(i18n.t('categoryReview.emptyMessage'))).toBeNull();
    });

    it('shows the empty state with no data', async () => {
      mockCandidates = [];
      mockRules = [];
      mockCategories = [];

      const screen = await renderReview();

      expect(i18n.t('categoryReview.emptyTitle')).not.toBe('categoryReview.emptyTitle');
      expect(screen.getByText(i18n.t('categoryReview.emptyTitle'))).toBeTruthy();
      expect(screen.getByText(i18n.t('categoryReview.emptyMessage'))).toBeTruthy();
      expect(screen.queryByTestId(LOADING)).toBeNull();
    });

    it('keeps the empty state off the screen while lines are listed', async () => {
      const screen = await renderReview();

      expect(linesOf(screen).length).toBeGreaterThan(0);
      expect(screen.queryByText(i18n.t('categoryReview.emptyTitle'))).toBeNull();
      expect(screen.queryByTestId(LOADING)).toBeNull();
    });

    it('shows the empty state when nothing is left', async () => {
      mockCandidates = [
        ...candidatesOf('Handset', 2, { categorySetByHand: true }),
        ...candidatesOf('Sorted', 2, { category: 'groceries' }),
      ];

      const screen = await renderReview();

      expect(screen.getByText(i18n.t('categoryReview.emptyTitle'))).toBeTruthy();
      expect(screen.getByText(i18n.t('categoryReview.emptyMessage'))).toBeTruthy();
      expect(screen.queryAllByTestId(LINE)).toHaveLength(0);
    });
  });

  describe('the lines', () => {
    it('shows one line per group with its counts', async () => {
      const screen = await renderReview();
      const [atb, silpo] = linesOf(screen);

      const atbCounts = [
        i18n.t('categoryReview.nameCount', { count: 2 }),
        i18n.t('categoryReview.rowCount', { count: ATB_ROWS }),
      ].join(' · ');

      expect(linesOf(screen)).toHaveLength(2);
      expect(within(atb).getByText(atbCounts)).toBeTruthy();
      expect(within(silpo).getByText('Silpo')).toBeTruthy();
      expect(
        within(silpo).getByText(i18n.t('categoryReview.rowCount', { count: SILPO_ROWS })),
      ).toBeTruthy();
    });

    it('names each line on its button, so VoiceOver tells the buttons apart', async () => {
      const screen = await renderReview();
      const [atb, silpo] = linesOf(screen);
      const labelOf = (name: string) => i18n.t('categoryReview.chooseFor', { name });

      expect(labelOf('ATB')).not.toBe('categoryReview.chooseFor');
      expect(within(atb).getByLabelText(labelOf('ATB'))).toBeTruthy();
      expect(within(silpo).getByLabelText(labelOf('Silpo'))).toBeTruthy();
      expect(within(atb).queryByLabelText(labelOf('Silpo'))).toBeNull();
    });

    it('gives a one-name line its row count and no name count', async () => {
      const screen = await renderReview();
      const [, silpo] = linesOf(screen);

      expect(silpo).not.toHaveTextContent(i18n.t('categoryReview.nameCount', { count: 1 }), {
        exact: false,
      });
    });

    it('reads Starts with for a prefix group', async () => {
      const screen = await renderReview();
      const [atb, silpo] = linesOf(screen);

      expect(
        within(atb).getByText(i18n.t('categoryReview.startsWith', { name: 'ATB' })),
      ).toBeTruthy();
      expect(
        within(silpo).queryByText(i18n.t('categoryReview.startsWith', { name: 'Silpo' })),
      ).toBeNull();
    });

    it('a line left alone stays, with no badge or count about it', async () => {
      const screen = await renderReview();
      const before = textsOf(linesOf(screen)[FIRST_LINE]);

      previewReturns(ATB_ROWS + 1);
      await pick(screen, FIRST_LINE);
      await fireEvent.press(within(screen.getByTestId(CONFIRM_SHEET)).getByText(CANCEL));

      expect(before.length).toBeGreaterThan(1);
      expect(linesOf(screen)).toHaveLength(2);
      expect(textsOf(linesOf(screen)[FIRST_LINE])).toEqual(before);
    });
  });

  describe('the options', () => {
    it('lists the other categories of the live table', async () => {
      mockCategories = [
        { key: 'groceries', title: 'Groceries', icon: 'cart', color: null },
        { key: 'pets', title: 'Pets', icon: 'pawprint', color: null },
        { key: 'other', title: 'Other', icon: 'square.grid.2x2', color: null },
      ];

      const screen = await renderReview();
      await pressChoose(screen, FIRST_LINE);
      const sheet = within(screen.getByTestId(OPTIONS_SHEET));

      expect(sheet.getByText('Groceries')).toBeTruthy();
      expect(sheet.getByText('Pets')).toBeTruthy();
      expect(sheet.queryByText('Transport')).toBeNull();
    });

    it('leaves other out of the options', async () => {
      const screen = await renderReview();
      await pressChoose(screen, FIRST_LINE);
      const sheet = within(screen.getByTestId(OPTIONS_SHEET));

      expect(sheet.getByText(resolveDefaultCategoryTitle('groceries', 'Groceries'))).toBeTruthy();
      expect(sheet.queryByText(resolveDefaultCategoryTitle('other', 'Other'))).toBeNull();
    });

    describe('in Ukrainian', () => {
      beforeEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
      });

      afterEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      });

      it('reads the title of a seeded category through resolveDefaultCategoryTitle', async () => {
        mockCategories = [
          { key: 'groceries', title: 'Groceries', icon: 'cart', color: null },
          { key: 'dining', title: 'My dining', icon: 'fork.knife', color: null },
        ];
        previewReturns(ATB_ROWS + 1);

        const screen = await renderReview();
        await pressChoose(screen, FIRST_LINE);
        const sheet = within(screen.getByTestId(OPTIONS_SHEET));
        const translated = i18n.t('categories.groceries');

        expect(translated).not.toBe('Groceries');
        expect(sheet.getByText(translated)).toBeTruthy();
        expect(sheet.queryByText('Groceries')).toBeNull();
        expect(sheet.getByText('My dining')).toBeTruthy();

        await pressOption(screen, translated);
        await closeSheet(OPTIONS_SHEET);

        expect(
          within(screen.getByTestId(CONFIRM_SHEET)).getByText(new RegExp(translated)),
        ).toBeTruthy();
      });
    });
  });

  describe('the write', () => {
    it.each([
      [FIRST_LINE, 'ATB', 'nameStartsWith', ATB_ROWS],
      [SECOND_LINE, 'Silpo', 'nameIs', SILPO_ROWS],
    ])(
      'writes at once when the preview equals the row count: line %i',
      async (lineIndex, name, kind, rowCount) => {
        previewReturns(rowCount);

        const screen = await renderReview();
        await pick(screen, lineIndex);

        expect(mockPreview).toHaveBeenCalledWith({
          text: name,
          kind,
          category: 'groceries',
          sourceTransactionId: null,
        });
        expect(mockApply).toHaveBeenCalledTimes(1);
        expect(mockApply).toHaveBeenCalledWith(groceriesPayload(name, kind));
        expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
        expect(alertSpy).not.toHaveBeenCalled();
      },
    );

    it('opens the confirm with the names when the preview is larger', async () => {
      previewReturns(ATB_ROWS + 3, ['ATB 0212', 'ATB 0340', 'ATB Market']);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);
      const confirm = within(screen.getByTestId(CONFIRM_SHEET));

      expect(confirm.getByText(i18n.t('categoryRulePreview.confirmTitle'))).toBeTruthy();
      expect(confirm.getByText(/ATB Market/)).toBeTruthy();
      expect(confirm.getByText(/ATB 0212/)).toBeTruthy();
      expect(mockApply).not.toHaveBeenCalled();
    });

    it('writes only on its confirm', async () => {
      previewReturns(ATB_ROWS + 3);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);

      expect(mockApply).not.toHaveBeenCalled();

      await pressMove(screen);

      expect(mockApply).toHaveBeenCalledTimes(1);
      expect(mockApply).toHaveBeenCalledWith(groceriesPayload('ATB', 'nameStartsWith'));
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
    });

    it('cancel writes nothing', async () => {
      previewReturns(ATB_ROWS + 3);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);
      await fireEvent.press(within(screen.getByTestId(CONFIRM_SHEET)).getByText(CANCEL));

      expect(mockApply).not.toHaveBeenCalled();
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      expect(linesOf(screen)).toHaveLength(2);
    });

    it('shows five names and and M more', async () => {
      previewReturns(ATB_ROWS + 3, NAMES);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);
      const shown = NAMES.slice(0, 5)
        .map((name) => i18n.t('common.listedName', { name }))
        .join(', ');
      const andMore = i18n.t('categoryRulePreview.namesAndMore', { names: shown, count: 2 });
      const confirm = within(screen.getByTestId(CONFIRM_SHEET));

      expect(confirm.getByText(/Name 5/)).toBeTruthy();
      expect(confirm.queryByText(/Name 6/)).toBeNull();
      expect(
        confirm.getByText(new RegExp(andMore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
      ).toBeTruthy();
    });

    it('opens the confirm only after the options sheet has closed', async () => {
      previewReturns(ATB_ROWS + 3);

      const screen = await renderReview();
      await pressChoose(screen, FIRST_LINE);
      await pressOption(screen, 'Groceries');

      expect(screen.queryByTestId(OPTIONS_SHEET)).toBeNull();
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      expect(mockModalProps.get(`${CONFIRM_SHEET}-modal`)?.visible ?? false).toBe(false);
      expect(mockPreview).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();

      await closeSheet(OPTIONS_SHEET);

      expect(screen.getByTestId(CONFIRM_SHEET)).toBeTruthy();
    });

    it('does nothing when the options sheet closes without a pick', async () => {
      const screen = await renderReview();
      await pressChoose(screen, FIRST_LINE);
      await act(async () => {
        mockModalProps.get(`${OPTIONS_SHEET}-modal`)?.onRequestClose?.();
      });
      await closeSheet(OPTIONS_SHEET);

      expect(screen.queryByTestId(OPTIONS_SHEET)).toBeNull();
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      expect(mockPreview).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
    });

    it('disables every line button while a write runs, and frees them after', async () => {
      const write = deferredWrite();
      mockApply.mockReturnValueOnce(write.promise);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);
      const buttons = ['ATB', 'Silpo'].map((name) =>
        screen.getByLabelText(i18n.t('categoryReview.chooseFor', { name })),
      );

      for (const button of buttons) {
        expect(button).toBeDisabled();
      }

      previewReturns(SILPO_ROWS);
      await fireEvent.press(buttons[SECOND_LINE]);

      expect(screen.queryByTestId(OPTIONS_SHEET)).toBeNull();
      expect(mockPreview).toHaveBeenCalledTimes(1);

      await act(async () => write.resolve(ATB_ROWS));

      for (const button of buttons) {
        expect(button).not.toBeDisabled();
      }

      await pick(screen, SECOND_LINE);

      expect(mockApply).toHaveBeenCalledTimes(2);
    });

    describe('while the confirmed write runs', () => {
      const DISMISSALS: [string, (screen: Screen) => Promise<void>][] = [
        [
          'Cancel',
          async (screen) => {
            await fireEvent.press(within(screen.getByTestId(CONFIRM_SHEET)).getByText(CANCEL));
          },
        ],
        [
          'a scrim or back dismiss',
          async () => {
            await act(async () => {
              mockModalProps.get(`${CONFIRM_SHEET}-modal`)?.onRequestClose?.();
            });
          },
        ],
      ];

      it.each(DISMISSALS)(
        'leaves the confirm open until the write ends: %s',
        async (_, dismiss) => {
          previewReturns(ATB_ROWS + 3);
          const write = deferredWrite();
          mockApply.mockReturnValueOnce(write.promise);

          const screen = await renderReview();
          await pick(screen, FIRST_LINE);
          await pressMove(screen);
          await dismiss(screen);

          expect(screen.getByTestId(CONFIRM_SHEET)).toBeTruthy();
          expect(mockApply).toHaveBeenCalledTimes(1);

          await act(async () => write.resolve(ATB_ROWS + 3));

          expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
          expect(mockApply).toHaveBeenCalledTimes(1);
        },
      );

      it('still lets Cancel close the confirm once the write has failed', async () => {
        previewReturns(ATB_ROWS + 3);
        mockApply.mockRejectedValueOnce(new Error('write failed'));

        const screen = await renderReview();
        await pick(screen, FIRST_LINE);
        await pressMove(screen);

        expect(alertSpy).toHaveBeenCalledTimes(1);

        await fireEvent.press(within(screen.getByTestId(CONFIRM_SHEET)).getByText(CANCEL));

        expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      });
    });

    it('writes once for a double tap on the confirm', async () => {
      previewReturns(ATB_ROWS + 3);
      const write = deferredWrite();
      mockApply.mockReturnValueOnce(write.promise);

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);
      const move = within(screen.getByTestId(CONFIRM_SHEET)).getByText(MOVE);
      await fireEvent.press(move);
      await fireEvent.press(move);

      expect(mockApply).toHaveBeenCalledTimes(1);

      await act(async () => write.resolve(ATB_ROWS + 3));
    });

    it('shows an alert and leaves the line when the write fails', async () => {
      mockApply.mockRejectedValueOnce(new Error('write failed'));

      const screen = await renderReview();
      await pick(screen, FIRST_LINE);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(linesOf(screen)).toHaveLength(2);

      await pick(screen, FIRST_LINE);

      expect(mockApply).toHaveBeenCalledTimes(2);
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('the reads', () => {
    it('pauses its reads while it is not visible, and never caches them', async () => {
      mockUseIsScreenVisible.mockReturnValue(false);

      await renderReview();

      const calls = mockUseLiveQuery.mock.calls;

      expect(calls.map(([query]) => query.__kind).sort()).toEqual([
        'candidates',
        'categories',
        'evidence',
        'rules',
      ]);

      for (const [, , , options] of calls) {
        expect(options).toMatchObject({ paused: true });
        expect(options.cached).toBeFalsy();
      }
    });

    it('leaves its reads running while it is visible', async () => {
      await renderReview();

      for (const [, , , options] of mockUseLiveQuery.mock.calls) {
        expect(options).toMatchObject({ paused: false });
        expect(options.cached).toBeFalsy();
      }
    });

    it('plans once every read has landed, never on a half-loaded set', async () => {
      const unread: unknown[] = [];

      mockLoading = { candidates: true, rules: true, categories: true, evidence: true };
      mockUseLiveQuery.mockImplementation((query: { __kind: ReadKind }) => ({
        data: mockLoading[query.__kind] ? unread : dataOf(query.__kind),
        isLoading: mockLoading[query.__kind],
        isFresh: true,
      }));

      const screen = await renderReview();

      expect(mockPlanCalls).not.toHaveBeenCalled();

      for (const read of ['candidates', 'rules', 'evidence'] as const) {
        mockLoading = { ...mockLoading, [read]: false };
        await screen.rerender(reviewElement());

        expect(mockPlanCalls).not.toHaveBeenCalled();
      }

      mockLoading = { ...mockLoading, categories: false };
      await screen.rerender(reviewElement());

      expect(mockPlanCalls).toHaveBeenCalledTimes(1);
      expect(linesOf(screen)).toHaveLength(2);
    });

    it('reads the candidates on the transactions, rules and categories tables', async () => {
      await renderReview();

      const candidateCall = mockUseLiveQuery.mock.calls.find(
        ([query]) => query.__kind === 'candidates',
      );

      expect(candidateCall?.[1]).toEqual(['transactions', 'category_rules', 'categories']);
    });
  });

  describe('the suggestion chip', () => {
    const suggestionText = (category: string, agreeing: number, total: number): string =>
      i18n.t('categoryReview.suggestion', { category, agreeing, total });

    const GROCERIES_CHIP = suggestionText('Groceries', 3, 3);

    const silpoSuggested = (): void => {
      mockEvidence = [{ description: 'Silpo 0712', categoryKey: 'groceries', rowCount: 3 }];
    };

    const pressChip = async (screen: Screen, lineIndex: number, text: string): Promise<void> => {
      await fireEvent.press(within(linesOf(screen)[lineIndex]).getByText(text));
    };

    it("shows the chip with the category's title and count", async () => {
      silpoSuggested();

      const screen = await renderReview();
      const [atb, silpo] = linesOf(screen);

      expect(within(silpo).getByText(GROCERIES_CHIP)).toBeTruthy();
      expect(GROCERIES_CHIP).not.toBe('categoryReview.suggestion');
      expect(GROCERIES_CHIP).toContain('Groceries');
      expect(within(atb).queryByText(GROCERIES_CHIP)).toBeNull();
    });

    it('names each chip on its button, so VoiceOver tells the chips apart', async () => {
      mockEvidence = [
        { description: 'ATB 0900', categoryKey: 'groceries', rowCount: 3 },
        { description: 'Silpo 0712', categoryKey: 'groceries', rowCount: 3 },
      ];

      const screen = await renderReview();
      const [atb, silpo] = linesOf(screen);
      const labelOf = (name: string) =>
        i18n.t('categoryReview.suggestionFor', {
          category: 'Groceries',
          name,
          agreeing: 3,
          total: 3,
        });

      expect(within(atb).getByText(GROCERIES_CHIP)).toBeTruthy();
      expect(within(silpo).getByText(GROCERIES_CHIP)).toBeTruthy();
      expect(labelOf('ATB')).not.toBe('categoryReview.suggestionFor');
      expect(labelOf('ATB')).not.toBe(labelOf('Silpo'));
      expect(within(atb).getByLabelText(labelOf('ATB'))).toBeTruthy();
      expect(within(silpo).getByLabelText(labelOf('Silpo'))).toBeTruthy();
      expect(within(atb).queryByLabelText(labelOf('Silpo'))).toBeNull();
    });

    it('disables the chip while a write runs, and frees it after', async () => {
      silpoSuggested();

      const write = deferredWrite();
      mockApply.mockReturnValueOnce(write.promise);

      const screen = await renderReview();
      const chip = within(linesOf(screen)[SECOND_LINE]).getByLabelText(
        i18n.t('categoryReview.suggestionFor', {
          category: 'Groceries',
          name: 'Silpo',
          agreeing: 3,
          total: 3,
        }),
      );

      expect(chip).not.toBeDisabled();

      await pick(screen, FIRST_LINE);

      expect(chip).toBeDisabled();

      previewReturns(SILPO_ROWS);
      await fireEvent.press(chip);

      expect(mockPreview).toHaveBeenCalledTimes(1);

      await act(async () => write.resolve(ATB_ROWS));

      expect(chip).not.toBeDisabled();
    });

    describe('in Ukrainian', () => {
      beforeEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
      });

      afterEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      });

      it('shows the translated title of a seeded category', async () => {
        silpoSuggested();

        const screen = await renderReview();
        const translated = i18n.t('categories.groceries');
        const silpo = within(linesOf(screen)[SECOND_LINE]);

        expect(translated).not.toBe('Groceries');
        expect(silpo.getByText(suggestionText(translated, 3, 3))).toBeTruthy();
        expect(silpo.queryByText(suggestionText('Groceries', 3, 3))).toBeNull();
      });

      it('shows the Ukrainian chip text and names the chip button in Ukrainian', async () => {
        silpoSuggested();

        const screen = await renderReview();
        const translated = i18n.t('categories.groceries');
        const chipText = suggestionText(translated, 3, 3);
        const chipLabel = i18n.t('categoryReview.suggestionFor', {
          category: translated,
          name: 'Silpo',
          agreeing: 3,
          total: 3,
        });
        const silpo = within(linesOf(screen)[SECOND_LINE]);

        expect(chipText).not.toBe('categoryReview.suggestion');
        expect(chipLabel).not.toBe('categoryReview.suggestionFor');
        expect(chipText).not.toBe(GROCERIES_CHIP);
        expect(chipLabel).not.toContain('Groceries');
        expect(silpo.getByText(chipText)).toBeTruthy();
        expect(silpo.getByLabelText(chipLabel)).toBeTruthy();
      });

      it.each([
        ['renamed seeded', 'groceries', 'My groceries'],
        ['user-made', 'corner-shop', 'Corner shop'],
      ])('shows the title of a %s category verbatim', async (_, key, title) => {
        mockCategories = [{ key, title, icon: 'cart', color: null }];
        mockEvidence = [{ description: 'Silpo 0712', categoryKey: key, rowCount: 3 }];

        const screen = await renderReview();
        const silpo = within(linesOf(screen)[SECOND_LINE]);

        expect(silpo.getByText(suggestionText(title, 3, 3))).toBeTruthy();
      });
    });

    it('shows no chip when there is no suggestion', async () => {
      mockEvidence = [{ description: 'Silpo 0712', categoryKey: 'groceries', rowCount: 1 }];

      const screen = await renderReview();
      const [, silpo] = linesOf(screen);

      expect(within(silpo).queryByText(suggestionText('Groceries', 1, 1))).toBeNull();
      expect(within(silpo).getByText(i18n.t('categoryReview.choose'))).toBeTruthy();
    });

    it('nothing changes until the chip is tapped', async () => {
      silpoSuggested();

      const screen = await renderReview();

      expect(within(linesOf(screen)[SECOND_LINE]).getByText(GROCERIES_CHIP)).toBeTruthy();
      expect(linesOf(screen)).toHaveLength(2);
      expect(screen.queryByTestId(OPTIONS_SHEET)).toBeNull();
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      expect(mockPreview).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
    });

    it('a tap runs the same preview and write as a pick', async () => {
      silpoSuggested();
      previewReturns(SILPO_ROWS);

      const screen = await renderReview();
      await pressChip(screen, SECOND_LINE, GROCERIES_CHIP);

      expect(mockPreview).toHaveBeenCalledTimes(1);
      expect(mockPreview).toHaveBeenCalledWith({
        text: 'Silpo',
        kind: 'nameIs',
        category: 'groceries',
        sourceTransactionId: null,
      });
      expect(mockApply).toHaveBeenCalledTimes(1);
      expect(mockApply).toHaveBeenCalledWith(groceriesPayload('Silpo', 'nameIs'));
      expect(screen.queryByTestId(CONFIRM_SHEET)).toBeNull();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('a tap with a larger preview opens the confirm', async () => {
      silpoSuggested();
      previewReturns(SILPO_ROWS + 3, ['Silpo 12', 'Silpo 7', 'Silpo Market']);

      const screen = await renderReview();
      await pressChip(screen, SECOND_LINE, GROCERIES_CHIP);
      const confirm = within(screen.getByTestId(CONFIRM_SHEET));

      expect(confirm.getByText(/Silpo Market/)).toBeTruthy();
      expect(mockApply).not.toHaveBeenCalled();

      await pressMove(screen);

      expect(mockApply).toHaveBeenCalledTimes(1);
      expect(mockApply).toHaveBeenCalledWith(groceriesPayload('Silpo', 'nameIs'));
    });

    it('picking another category resolves the line by a rule', async () => {
      silpoSuggested();
      previewReturns(SILPO_ROWS);

      const screen = await renderReview();

      expect(within(linesOf(screen)[SECOND_LINE]).getByText(GROCERIES_CHIP)).toBeTruthy();

      await pick(screen, SECOND_LINE, 'Transport');

      expect(mockApply).toHaveBeenCalledTimes(1);
      expect(mockApply).toHaveBeenCalledWith({
        name: 'Silpo',
        kind: 'nameIs',
        category: 'transport',
        sourceTransactionId: null,
      });
    });

    it('the evidence read is paused and uncached with the others', async () => {
      mockUseIsScreenVisible.mockReturnValue(false);

      await renderReview();

      const evidenceCalls = mockUseLiveQuery.mock.calls.filter(
        ([query]) => query.__kind === 'evidence',
      );

      expect(evidenceCalls).toHaveLength(1);

      for (const [, , , options] of evidenceCalls) {
        expect(options).toMatchObject({ paused: true });
        expect(options.cached).toBeFalsy();
      }
    });
  });
});
