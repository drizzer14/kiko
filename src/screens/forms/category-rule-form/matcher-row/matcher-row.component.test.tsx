import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { fieldSuffix } from '@kiko/test-support/field-suffix';

import { emptyMatcherDraft } from '../rule-draft';

import MatcherRow from './matcher-row.component';
import type { MatcherRowProps } from './matcher-row.props';

const renderRow = (overrides: Partial<MatcherRowProps> = {}) =>
  render(
    <MatcherRow
      draft={emptyMatcherDraft('UAH')}
      position={0}
      canRemove={false}
      onChange={jest.fn()}
      onRemove={jest.fn()}
      error={undefined}
      {...overrides}
    />,
  );

const draftOf = (fields: Partial<ReturnType<typeof emptyMatcherDraft>>) => ({
  ...emptyMatcherDraft('UAH'),
  ...fields,
});

describe('MatcherRow', () => {
  describe('the condition type', () => {
    it('shows the type the row has', async () => {
      const { getByText } = await renderRow({ draft: draftOf({ type: 'nameStartsWith' }) });

      expect(getByText('Name starts with')).toBeTruthy();
    });

    it.each([
      ['Name is', 'nameIs'],
      ['Name starts with', 'nameStartsWith'],
      ['Amount', 'amount'],
      ['Type', 'direction'],
      ['Time', 'time'],
    ] as const)('offers "%s" and reports the pick', async (label, type) => {
      const onChange = jest.fn();
      const { getByTestId, getAllByText } = await renderRow({
        draft: draftOf({ type: type === 'nameIs' ? 'time' : 'nameIs' }),
        onChange,
      });

      await fireEvent.press(getByTestId('matcher-type-0'));

      expect(getAllByText(label).length).toBeGreaterThan(0);

      await fireEvent.press(getByTestId(`matcher-type-0-option-${type}`));

      expect(onChange).toHaveBeenCalledWith({ type });
    });
  });

  describe('a name condition', () => {
    it.each(['nameIs', 'nameStartsWith'] as const)(
      'shows a name field for %s and reports what is typed',
      async (type) => {
        const onChange = jest.fn();
        const { getByLabelText, queryByLabelText } = await renderRow({
          draft: draftOf({ type, text: 'Silpo' }),
          onChange,
        });

        expect(getByLabelText('Name').props.value).toBe('Silpo');
        expect(queryByLabelText('Amount')).toBeNull();

        await fireEvent.changeText(getByLabelText('Name'), 'Silpo Market');

        expect(onChange).toHaveBeenCalledWith({ text: 'Silpo Market' });
      },
    );

    it('shows its error under the name field', async () => {
      const { getByText } = await renderRow({
        draft: draftOf({ type: 'nameIs' }),
        error: 'Enter a name.',
      });

      expect(getByText('Enter a name.')).toBeTruthy();
    });
  });

  describe('an amount condition', () => {
    const amountDraft = draftOf({ type: 'amount', amountText: '500', currency: 'USD' });

    it('shows the comparison, the amount with its currency symbol, and the currency', async () => {
      const { getByText, getByLabelText, getByTestId } = await renderRow({ draft: amountDraft });

      expect(getByText('Equal to')).toBeTruthy();
      expect(getByLabelText('Amount').props.value).toBe('500');
      expect(fieldSuffix(getByLabelText('Amount'))).toBe('$');
      expect(getByTestId('matcher-currency-0')).toHaveTextContent(/US Dollar/);
    });

    it.each([
      ['Equal to', 'eq'],
      ['More than', 'gt'],
      ['At least', 'gte'],
      ['Less than', 'lt'],
      ['At most', 'lte'],
    ] as const)('offers "%s" as a comparison', async (label, operator) => {
      const onChange = jest.fn();
      const { getByTestId, getAllByText } = await renderRow({
        draft: draftOf({ type: 'amount', amountOperator: operator === 'eq' ? 'lt' : 'eq' }),
        onChange,
      });

      await fireEvent.press(getByTestId('matcher-operator-0'));

      expect(getAllByText(label).length).toBeGreaterThan(0);

      await fireEvent.press(getByTestId(`matcher-operator-0-option-${operator}`));

      expect(onChange).toHaveBeenCalledWith({ amountOperator: operator });
    });

    it('groups the thousands of what is typed', async () => {
      const onChange = jest.fn();
      const { getByLabelText } = await renderRow({ draft: amountDraft, onChange });

      await fireEvent.changeText(getByLabelText('Amount'), '1234567');

      expect(onChange).toHaveBeenCalledWith({ amountText: '1 234 567' });
    });

    it('reports a picked currency', async () => {
      const onChange = jest.fn();
      const { getByTestId, getByPlaceholderText } = await renderRow({
        draft: amountDraft,
        onChange,
      });

      await fireEvent.press(getByTestId('matcher-currency-0'));
      await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'EUR');
      await fireEvent.press(getByTestId('currency-option-EUR'));

      expect(onChange).toHaveBeenCalledWith({ currency: 'EUR' });
    });

    it('shows its error under the amount field, not a name error', async () => {
      const { getByText, queryByText } = await renderRow({
        draft: amountDraft,
        error: 'Enter an amount of 0 or more.',
      });

      expect(getByText('Enter an amount of 0 or more.')).toBeTruthy();
      expect(queryByText('Enter a name.')).toBeNull();
    });
  });

  describe('an expense or income condition', () => {
    it('offers Expense and Income, with the draft one selected', async () => {
      const { getByRole } = await renderRow({ draft: draftOf({ type: 'direction' }) });

      expect(getByRole('button', { name: /Expense/, selected: true })).toBeTruthy();
      expect(getByRole('button', { name: /Income/, selected: false })).toBeTruthy();
    });

    it('reports the other one', async () => {
      const onChange = jest.fn();
      const { getByText } = await renderRow({ draft: draftOf({ type: 'direction' }), onChange });

      await fireEvent.press(getByText('Income'));

      expect(onChange).toHaveBeenCalledWith({ direction: 'income' });
    });
  });

  describe('a time condition', () => {
    const timeDraft = draftOf({ type: 'time', timeOperator: 'after', minuteOfDay: 18 * 60 + 30 });

    it('offers Before and After, and shows the time on the device clock', async () => {
      const { getByRole, getByText } = await renderRow({ draft: timeDraft });

      expect(getByRole('button', { name: /After/, selected: true })).toBeTruthy();
      expect(getByRole('button', { name: /Before/, selected: false })).toBeTruthy();
      expect(getByText('18:30')).toBeTruthy();
    });

    it('reports Before', async () => {
      const onChange = jest.fn();
      const { getByText } = await renderRow({ draft: timeDraft, onChange });

      await fireEvent.press(getByText('Before'));

      expect(onChange).toHaveBeenCalledWith({ timeOperator: 'before' });
    });

    it('reports a picked time as a minute of the day', async () => {
      const onChange = jest.fn();
      const { getByLabelText, getByTestId } = await renderRow({ draft: timeDraft, onChange });

      await fireEvent.press(getByLabelText('Time'));
      await fireEvent(
        getByTestId('Time picker'),
        'change',
        { type: 'set' },
        new Date(1999, 11, 31, 7, 5),
      );

      expect(onChange).toHaveBeenCalledWith({ minuteOfDay: 7 * 60 + 5 });
    });

    it('says how a statement row without a time is read', async () => {
      const { getByText } = await renderRow({ draft: timeDraft });

      expect(
        getByText("Statement rows without a time count as noon in the statement's time zone."),
      ).toBeTruthy();
    });

    it.each(['nameIs', 'amount', 'direction'] as const)(
      'does not show the time hint on a %s condition',
      async (type) => {
        const { queryByText } = await renderRow({ draft: draftOf({ type }) });

        expect(queryByText(/Statement rows without a time/)).toBeNull();
      },
    );
  });

  describe('removing the row', () => {
    it('offers Remove, labelled with the position of the row, when it can go', async () => {
      const onRemove = jest.fn();
      const { getByLabelText } = await renderRow({ position: 1, canRemove: true, onRemove });

      await fireEvent.press(getByLabelText('Remove condition 2'));

      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('offers nothing to remove on the last row', async () => {
      const { queryByText } = await renderRow({ canRemove: false });

      expect(queryByText('Remove')).toBeNull();
    });
  });

  describe('under the uk language', () => {
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

    it('labels the condition and its comparison in Ukrainian', async () => {
      const { getByLabelText, getByText } = await renderRow({ draft: draftOf({ type: 'amount' }) });

      expect(getByLabelText('Умова')).toBeTruthy();
      expect(getByLabelText('Сума')).toBeTruthy();
      expect(getByText('Дорівнює')).toBeTruthy();
    });

    it('says how a statement row without a time is read, in Ukrainian', async () => {
      const { getByText } = await renderRow({ draft: draftOf({ type: 'time' }) });

      expect(
        getByText('Рядки виписки без часу рахуються як полудень у часовому поясі виписки.'),
      ).toBeTruthy();
    });
  });
});
