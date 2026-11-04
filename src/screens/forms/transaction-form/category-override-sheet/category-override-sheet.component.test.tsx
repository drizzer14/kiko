import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import CategoryOverrideSheet from '.';
import type { CategoryOverrideSheetProps } from './category-override-sheet.props';

// The Jest unistyles mock strips `variants` from the resolved style, so a button's variant is read
// from the props the sheet passes.
jest.mock('@kiko/design-system/components/button', () => {
  const actual = jest.requireActual('@kiko/design-system/components/button');

  return { __esModule: true, default: jest.fn(actual.default) };
});

const { default: mockButton } = jest.requireMock('@kiko/design-system/components/button') as {
  default: jest.Mock;
};

type PrefixProps = Pick<
  CategoryOverrideSheetProps,
  'prefix' | 'onOfferPrefix' | 'isOfferingPrefix' | 'prefixConfirm'
>;

type PrefixConfirm = NonNullable<PrefixProps['prefixConfirm']>;

const APPLY = i18n.t('forms.transaction.apply');
const APPLY_TO_ONE = i18n.t('forms.transaction.applyToThisOne');
const CANCEL = i18n.t('common.cancel');
const PREFIX_LABEL = i18n.t('forms.transaction.applyToAllStartingWith', { prefix: 'ATB' });
const MOVE = i18n.t('categoryRulePreview.confirm');
const CONFIRM_MESSAGE = '23 transactions move to "Food": ATB 0212, ATB 0340.';

const baseProps: Omit<CategoryOverrideSheetProps, keyof PrefixProps> = {
  visible: true,
  onDismiss: jest.fn(),
  categoryIcon: 'fork.knife',
  message: 'Apply "Food" to all transactions named "ATB 0212"?',
  canApplyToOne: true,
  onApply: jest.fn(),
  isApplying: false,
  onApplyOne: jest.fn(),
  isApplyingOne: false,
  isWriting: false,
};

const noPrefix: PrefixProps = {
  prefix: null,
  onOfferPrefix: jest.fn(),
  isOfferingPrefix: false,
  prefixConfirm: null,
};

const withPrefix: PrefixProps = { ...noPrefix, prefix: 'ATB' };

const renderSheet = (prefixProps: PrefixProps, props: Partial<CategoryOverrideSheetProps> = {}) =>
  render(<CategoryOverrideSheet {...baseProps} {...props} {...prefixProps} />);

const buttonPropsFor = (label: string): Record<string, unknown> => {
  const call = [...mockButton.mock.calls].reverse().find(([props]) => props.children === label);

  if (call === undefined) {
    throw new Error(`no Button rendered with the label ${label}`);
  }

  return call[0];
};

const buttonLabelsInOrder = (sheet: ReturnType<typeof within>): string[] =>
  sheet
    .getAllByRole('button')
    .map((button) => within(button).getAllByText(/.+/)[0]?.props.children as string);

const confirming = (overrides: Partial<PrefixConfirm> = {}): PrefixProps => ({
  ...withPrefix,
  prefixConfirm: {
    message: CONFIRM_MESSAGE,
    onConfirm: jest.fn(),
    onBack: jest.fn(),
    isApplying: false,
    ...overrides,
  },
});

describe('CategoryOverrideSheet', () => {
  beforeEach(() => {
    mockButton.mockClear();
  });

  it('keeps Apply first and Just for this one for a name with no prefix', async () => {
    const { getByTestId, queryByText } = await renderSheet(noPrefix);

    expect(buttonLabelsInOrder(within(getByTestId('category-override-sheet')))).toEqual([
      APPLY,
      APPLY_TO_ONE,
      CANCEL,
    ]);
    expect(queryByText(PREFIX_LABEL)).toBeNull();
  });

  it('shows the prefix button as secondary below Apply', async () => {
    const { getByTestId, getByText } = await renderSheet(withPrefix);

    const labels = buttonLabelsInOrder(within(getByTestId('category-override-sheet')));

    expect(getByText(PREFIX_LABEL)).toBeTruthy();
    expect(labels[0]).toBe(APPLY);
    expect(labels.indexOf(PREFIX_LABEL)).toBeGreaterThan(0);
    expect(labels.indexOf(PREFIX_LABEL)).toBeLessThan(labels.indexOf(CANCEL));
    expect(buttonPropsFor(APPLY).variant ?? 'primary').toBe('primary');
    expect(buttonPropsFor(PREFIX_LABEL).variant).toBe('secondary');
  });

  it('reports a press of the prefix button, and shows it busy while the preview loads', async () => {
    const onOfferPrefix = jest.fn();
    const { getByText, rerender } = await renderSheet({ ...withPrefix, onOfferPrefix });

    await fireEvent.press(getByText(PREFIX_LABEL));

    expect(onOfferPrefix).toHaveBeenCalledTimes(1);
    expect(buttonPropsFor(PREFIX_LABEL).loading ?? false).toBe(false);

    const busy: PrefixProps = { ...withPrefix, onOfferPrefix, isOfferingPrefix: true };

    await rerender(<CategoryOverrideSheet {...baseProps} {...busy} />);

    expect(buttonPropsFor(PREFIX_LABEL).loading).toBe(true);
  });

  describe('the confirm content', () => {
    it('swaps to the confirm content in the same sheet', async () => {
      const first = await renderSheet(withPrefix);
      const offered = within(first.getByTestId('category-override-sheet'));

      expect(offered.getByText(APPLY)).toBeTruthy();
      expect(offered.getByText(APPLY_TO_ONE)).toBeTruthy();
      expect(offered.getByText(PREFIX_LABEL)).toBeTruthy();
      expect(offered.queryByText(CONFIRM_MESSAGE)).toBeNull();
      expect(offered.queryByText(MOVE)).toBeNull();

      await first.unmount();
      const second = await renderSheet(confirming());
      const confirm = within(second.getByTestId('category-override-sheet'));

      expect(confirm.getByText(CONFIRM_MESSAGE)).toBeTruthy();
      expect(confirm.getByText(MOVE)).toBeTruthy();
      expect(confirm.queryByText(APPLY)).toBeNull();
      expect(confirm.queryByText(APPLY_TO_ONE)).toBeNull();
      expect(confirm.queryByText(PREFIX_LABEL)).toBeNull();
      expect(confirm.queryByText(baseProps.message)).toBeNull();
    });

    it('confirms with Move and goes back with the ghost button', async () => {
      const onConfirm = jest.fn();
      const onBack = jest.fn();
      const { getByText } = await renderSheet(confirming({ onConfirm, onBack }));

      const ghostLabels = [
        ...new Set(
          mockButton.mock.calls
            .map(([props]) => props)
            .filter((props) => props.variant === 'ghost')
            .map((props) => props.children as string),
        ),
      ];

      expect(buttonPropsFor(MOVE).variant ?? 'primary').toBe('primary');
      expect(ghostLabels).toHaveLength(1);

      await fireEvent.press(getByText(MOVE));

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onBack).not.toHaveBeenCalled();

      await fireEvent.press(getByText(ghostLabels[0] as string));

      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows Move busy while the write runs', async () => {
      await renderSheet(confirming({ isApplying: true }));

      expect(buttonPropsFor(MOVE).loading).toBe(true);
    });
  });
});
