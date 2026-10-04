import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { bankIds, OTHER_BANK_ID } from '@kiko/bank-sync/bank-catalog';

import BankTypeField from '.';

// Renders the field with nothing selected and opens its sheet — the shared
// setup every per-bank it.each test below starts from.
const renderOpenSheet = async () => {
  const onSelect = jest.fn();
  const utils = await render(
    <BankTypeField
      label="Bank type"
      sheetTitle="Select a Bank"
      selected={null}
      onSelect={onSelect}
      testID="bank-type-field"
    />,
  );

  await fireEvent.press(utils.getByTestId('bank-type-field'));

  return utils;
};

describe('BankTypeField', () => {
  // Nothing picked reads as the placeholder (like the broker field), not as a
  // selected value: a new account must make a choice.
  it('shows the "Select a bank" placeholder before anything is picked, and opens the sheet on press', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    expect(getByLabelText('Bank type')).toBeTruthy();
    expect(getByTestId('bank-type-field')).toHaveTextContent('Select a bank');

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-sheet')).toBeTruthy();
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByText } = await renderOpenSheet();

    expect(getByText('Select a Bank')).toBeTruthy();
  });

  it('lists all ten banks and Other bank, Monobank connectable and the rest import-only', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getAllByText } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(getByTestId('bank-type-option-alfa')).toBeTruthy();
    expect(getByTestId('bank-type-option-pumb')).toBeTruthy();
    expect(getByTestId('bank-type-option-oschadbank')).toBeTruthy();
    expect(getByTestId('bank-type-option-raiffeisen')).toBeTruthy();
    expect(getByTestId('bank-type-option-ukrgasbank')).toBeTruthy();
    // Monobank alone shows the connect-capable caption; PrivatBank, Sensebank,
    // ProCredit, UKRSIBBANK, and Alfa-Bank (import-only, each with its own
    // dedicated `statement-import` parser) share the "Statement import only"
    // caption.
    expect(getAllByText('Connect and import statements.')).toHaveLength(1);
    expect(getAllByText('Statement import only — no live connection.')).toHaveLength(5);
    // PUMB, Oschadbank, Raiffeisen, and Ukrgasbank have no dedicated
    // `statement-import` parser — they import only through the generic
    // column-mapping screen, and say so honestly instead of implying a
    // format-specific preview that doesn't exist for them.
    expect(getAllByText('Import with column mapping')).toHaveLength(4);
  });

  it('offers no separate "none" row: the one fallback is the "Other bank" catalog row', async () => {
    const { getByTestId, queryByTestId } = await renderOpenSheet();

    expect(queryByTestId('bank-type-option-none')).toBeNull();
    expect(getByTestId('bank-type-option-other')).toBeTruthy();
  });

  it('lists "Other bank" last, after every named bank, exactly like the broker list', async () => {
    const { getByTestId } = await renderOpenSheet();
    const optionIds = [
      ...JSON.stringify(getByTestId('bank-type-sheet').toJSON()).matchAll(
        /"testID":"bank-type-option-([a-z]+)"/g,
      ),
    ].map((match) => match[1]);

    expect(optionIds).toEqual([...bankIds]);
  });

  it('renders "Other bank" with no capability caption and no connect or statement-format icon', async () => {
    const { getByTestId } = await renderOpenSheet();

    const optionTree = JSON.stringify(getByTestId('bank-type-option-other').toJSON());
    expect(optionTree).toContain('Other bank');
    expect(optionTree).not.toContain('receipt');
    expect(optionTree).not.toContain('arrow.trianglehead.2.clockwise.rotate.90');
    expect(optionTree).not.toContain('Statement import only');
  });

  it('shows the live-sync icon on Monobank only, never on "Other bank"', async () => {
    const { getByTestId, queryByTestId } = await renderOpenSheet();

    expect(getByTestId('bank-type-option-monobank-connect-icon')).toBeTruthy();
    expect(queryByTestId('bank-type-option-other-connect-icon')).toBeNull();
  });

  // An unlisted bank has no parser, so its statements come in through the
  // column-mapping screen: the very glyph the no-parser banks show for it.
  it('shows the column-mapping icon on "Other bank", at the caption icon-size step', async () => {
    const { getByTestId } = await renderOpenSheet();

    const icon = getByTestId('bank-type-option-other-column-mapping-icon');

    expect(icon.props.name).toBe('increase.indent');
    expect(icon.props.size).toBe(darkTheme.iconSizes.caption);
  });

  it('draws "Other bank" the same column-mapping glyph a no-parser bank shows, not the Import statement glyph', async () => {
    const { getByTestId } = await renderOpenSheet();

    const otherIcon = getByTestId('bank-type-option-other-column-mapping-icon');
    const pumbIcon = getByTestId('bank-type-option-pumb-column-mapping-icon');

    expect(otherIcon.props.name).toBe(pumbIcon.props.name);
    expect(JSON.stringify(getByTestId('bank-type-option-other').toJSON())).not.toContain(
      'doc.badge.plus',
    );
  });

  it('draws the picked "Other bank" row\'s column-mapping glyph in the white on-accent hex', async () => {
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected="other"
        onSelect={jest.fn()}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    const icon = getByTestId('bank-type-option-other-column-mapping-icon');

    expect(icon.props.name).toBe('increase.indent');
    // `onAccent` is a hex token, which `toSFSymbolTintColor` hands to the
    // native tint unchanged. It equals `textPrimary` in the one dark theme, so
    // this pins that the glyph has a resolved white tint, not that it differs
    // from an unselected row.
    expect(icon.props.tintColor).toBe(darkTheme.colors.onAccent);
  });

  // The same description the named banks without a dedicated statement parser
  // read out (`captionFor`), so VoiceOver says what the row can do.
  it('reads "Other bank" out with the description the no-parser banks use', async () => {
    const { getByTestId } = await renderOpenSheet();

    expect(getByTestId('bank-type-option-other').props.accessibilityLabel).toBe(
      'Other bank. Import with column mapping',
    );
  });

  it('shows "Other bank" as the trigger value, and its row selected, when picked', async () => {
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected="other"
        onSelect={jest.fn()}
        testID="bank-type-field"
      />,
    );

    expect(getByTestId('bank-type-field')).toHaveTextContent('Other bank');

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-other').props.accessibilityState.selected).toBe(true);
  });

  it('reports "other" when the Other bank row is pressed', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-other'));

    expect(onSelect).toHaveBeenCalledWith('other');
  });

  it('marks "Other bank" unselected once a real bank is picked', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-other').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('bank-type-option-monobank').props.accessibilityState.selected).toBe(true);
  });

  it('marks the field required and shows its error under it', async () => {
    const { getByTestId, getByText } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={jest.fn()}
        required
        error="Select a bank."
        testID="bank-type-field"
      />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('Select a bank.')).toBeTruthy();
    expect(getByTestId('bank-type-field-error')).toBeTruthy();
  });

  it('shows no asterisk and no error by default', async () => {
    const { queryByText, queryByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={jest.fn()}
        testID="bank-type-field"
      />,
    );

    expect(queryByText('*')).toBeNull();
    expect(queryByTestId('bank-type-field-error')).toBeNull();
  });

  it('reports the picked bank id when a row is pressed', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-privatbank'));

    expect(onSelect).toHaveBeenCalledWith('privatbank');
  });

  it('shows the selected bank name as the trigger value', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    expect(getByTestId('bank-type-field')).toHaveTextContent('Monobank');
  });

  it('shows a checkmark on the currently-picked bank option, matching the app picker pattern', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('bank-type-option-privatbank').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it("shows Monobank's description with BOTH the live-sync and statements icons", async () => {
    const onSelect = jest.fn();
    const { getByTestId, toJSON } = await render(
      <BankTypeField
        label="Bank type"
        sheetTitle="Select a Bank"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('arrow.trianglehead.2.clockwise.rotate.90');
    expect(tree).toContain('receipt');
  });

  it("sizes the capability icons at the caption icon-size step (one step down from the row's own body text size)", async () => {
    const { getByTestId } = await renderOpenSheet();

    expect(getByTestId('bank-type-option-monobank-connect-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
    expect(getByTestId('bank-type-option-monobank-import-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
    expect(getByTestId('bank-type-option-privatbank-import-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
  });

  // Column-mapping import is a capability shown on EVERY catalog bank — a
  // sync-connectable bank, one with a
  // dedicated statement format, a column-mapping-only bank and "Other bank"
  // all get it.
  it.each([...bankIds])('shows the column-mapping capability icon on %s', async (bankId) => {
    const { getByTestId } = await renderOpenSheet();

    expect(getByTestId(`bank-type-option-${bankId}-column-mapping-icon`).props.name).toBe(
      'increase.indent',
    );
  });

  describe('the not-a-bank disclaimer under the field', () => {
    const englishClause =
      'Kiko is an independent app. It is not a bank and is not affiliated with or endorsed by any bank.';
    const ukrainianClause =
      'Кіко — незалежний застосунок. Це не банк, не є партнером та не пов’язаний з жодним банком.';

    // One caption, under the trigger: the sheet repeats nothing.
    it('shows the clause once, under the field, while the sheet is open', async () => {
      const { getAllByText } = await renderOpenSheet();

      expect(getAllByText(englishClause)).toHaveLength(1);
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    // The same place as the broker field's clause: a caption under the
    // trigger, there before any bank is picked and with the sheet closed.
    it('shows the clause under the trigger before a bank is picked, with the sheet closed', async () => {
      const { getByText } = await render(
        <BankTypeField
          label="Bank type"
          sheetTitle="Select a Bank"
          selected={null}
          onSelect={jest.fn()}
          testID="bank-type-field"
        />,
      );

      expect(getByText(englishClause)).toBeTruthy();
    });

    it.each([
      ['a named bank', 'privatbank'],
      ['Other bank', OTHER_BANK_ID],
    ] as const)('shows the same clause when %s is picked', async (_label, selected) => {
      const { getByText } = await render(
        <BankTypeField
          label="Bank type"
          sheetTitle="Select a Bank"
          selected={selected}
          onSelect={jest.fn()}
          testID="bank-type-field"
        />,
      );

      expect(getByText(englishClause)).toBeTruthy();
    });

    it('shows the Ukrainian clause, naming the app Кіко, in uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByText } = await render(
        <BankTypeField
          label="Тип банку"
          sheetTitle="Тип банку"
          selected={null}
          onSelect={jest.fn()}
          testID="bank-type-field"
        />,
      );

      expect(getByText(ukrainianClause)).toBeTruthy();
    });
  });

  it.each(['privatbank', 'sensebank', 'procredit', 'ukrsib', 'alfa'])(
    "shows %s's description with the statements icon (a dedicated statementFormatId), no sync icon",
    async (bankId) => {
      const { getByTestId } = await renderOpenSheet();

      const optionTree = JSON.stringify(getByTestId(`bank-type-option-${bankId}`).toJSON());
      expect(optionTree).toContain('receipt');
      expect(optionTree).not.toContain('arrow.trianglehead.2.clockwise.rotate.90');
    },
  );

  // Each capability icon stands for exactly one real capability — `receipt`
  // means a known, dedicated statement format. A bank with no
  // `statementFormatId` (column-mapping only) must not show it, or the icon
  // would imply a capability the bank doesn't actually have.
  it.each(['pumb', 'oschadbank', 'raiffeisen', 'ukrgasbank'])(
    'does not show the receipt icon on %s (no dedicated statementFormatId — column-mapping only)',
    async (bankId) => {
      const { getByTestId } = await renderOpenSheet();

      const optionTree = JSON.stringify(getByTestId(`bank-type-option-${bankId}`).toJSON());
      expect(optionTree).not.toContain('receipt');
      expect(optionTree).not.toContain('arrow.trianglehead.2.clockwise.rotate.90');
      // Column mapping is still shown — the bank's only real import path.
      expect(optionTree).toContain('increase.indent');
    },
  );
});
