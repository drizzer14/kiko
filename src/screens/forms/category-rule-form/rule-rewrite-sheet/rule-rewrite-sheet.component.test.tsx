import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import RuleRewriteSheet from './rule-rewrite-sheet.component';
import type { RuleRewriteSheetProps } from './rule-rewrite-sheet.props';

const renderSheet = (overrides: Partial<RuleRewriteSheetProps> = {}) =>
  render(
    <RuleRewriteSheet
      visible
      count={3}
      onApply={jest.fn()}
      isApplying={false}
      onKeepNew={jest.fn()}
      isKeepingNew={false}
      onDismiss={jest.fn()}
      onClosed={jest.fn()}
      {...overrides}
    />,
  );

describe('RuleRewriteSheet', () => {
  it('names how many transactions the rule changes, under its own title', async () => {
    const { getByText } = await renderSheet({ count: 3 });

    expect(getByText('Apply Rule')).toBeTruthy();
    expect(getByText('This changes 3 transactions.')).toBeTruthy();
  });

  it('says "transaction" for a single one', async () => {
    const { getByText } = await renderSheet({ count: 1 });

    expect(getByText('This changes 1 transaction.')).toBeTruthy();
  });

  it('offers to apply to the existing transactions, to keep to new ones, and to cancel', async () => {
    const { getByText } = await renderSheet();

    expect(getByText('Apply to existing')).toBeTruthy();
    expect(getByText('New transactions only')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('reports each choice on its own button', async () => {
    const onApply = jest.fn();
    const onKeepNew = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await renderSheet({ onApply, onKeepNew, onDismiss });

    await fireEvent.press(getByText('Apply to existing'));
    await fireEvent.press(getByText('New transactions only'));
    await fireEvent.press(getByText('Cancel'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onKeepNew).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while it is hidden', async () => {
    const { queryByText } = await renderSheet({ visible: false });

    expect(queryByText('Apply Rule')).toBeNull();
  });

  it('lets only the running choice work, and does not let Cancel interrupt a write', async () => {
    const onKeepNew = jest.fn();
    const onDismiss = jest.fn();
    const { getByText, getByRole } = await renderSheet({
      isApplying: true,
      onKeepNew,
      onDismiss,
    });

    expect(getByRole('button', { name: 'Apply to existing' }).props.accessibilityState.busy).toBe(
      true,
    );

    await fireEvent.press(getByText('New transactions only'));
    await fireEvent.press(getByText('Cancel'));

    expect(onKeepNew).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('tells the screen once the sheet has finished closing', async () => {
    const onClosed = jest.fn();
    const { getByTestId } = await renderSheet({ onClosed });

    await fireEvent(getByTestId('rule-rewrite-sheet-modal'), 'dismiss');

    expect(onClosed).toHaveBeenCalledTimes(1);
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

    it.each([
      [1, 'Це змінить 1 транзакцію.'],
      [2, 'Це змінить 2 транзакції.'],
      [5, 'Це змінить 5 транзакцій.'],
      [21, 'Це змінить 21 транзакцію.'],
      [12, 'Це змінить 12 транзакцій.'],
    ])('agrees the noun with %s', async (count, message) => {
      const { getByText } = await renderSheet({ count });

      expect(getByText(message)).toBeTruthy();
    });

    it('titles the sheet and its choices in Ukrainian', async () => {
      const { getByText } = await renderSheet();

      expect(getByText('Застосувати правило')).toBeTruthy();
      expect(getByText('Застосувати до наявних')).toBeTruthy();
      expect(getByText('Лише нові транзакції')).toBeTruthy();
    });
  });
});
