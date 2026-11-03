import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { exchangeCatalog, type ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';

import ExchangeTypeField from '.';

const renderField = (
  selected: ExchangeCatalogId | null = null,
  props: { onSelect?: (id: ExchangeCatalogId) => void; disabled?: boolean } = {},
) =>
  render(
    <ExchangeTypeField
      label="Exchange or wallet"
      sheetTitle="Exchange or Wallet"
      selected={selected}
      onSelect={props.onSelect ?? jest.fn()}
      disabled={props.disabled}
      testID="exchange-type-field"
    />,
  );

const renderOpenSheet = async () => {
  const view = await renderField();

  await fireEvent.press(view.getByTestId('exchange-type-field'));

  return view;
};

const OPTION_TEST_ID = /^exchange-type-option-[a-z_]+$/;

describe('ExchangeTypeField', () => {
  it('lists every exchange catalog entry with Other last', async () => {
    const { getAllByTestId, getByText } = await renderOpenSheet();

    const optionIds = getAllByTestId(OPTION_TEST_ID).map((option) =>
      String(option.props.testID).replace('exchange-type-option-', ''),
    );

    expect(optionIds).toEqual(exchangeCatalog.map((entry) => entry.id));
    expect(optionIds.at(-1)).toBe('other');
    expect(getByText('Exchange or Wallet')).toBeTruthy();
  });

  it('shows the connect icon only on a connectable entry', async () => {
    const { getByTestId, queryByTestId } = await renderOpenSheet();

    for (const entry of exchangeCatalog) {
      const icon = queryByTestId(`exchange-type-option-${entry.id}-connect-icon`);

      expect(icon !== null).toBe(entry.connectable);
    }

    const icon = getByTestId('exchange-type-option-binance-connect-icon');

    expect(icon.props.name).toBe('arrow.trianglehead.2.clockwise.rotate.90');
    expect(icon.props.size).toBe(darkTheme.iconSizes.caption);
    expect(queryByTestId('exchange-type-option-btc_wallet-connect-icon')).toBeTruthy();
    expect(queryByTestId('exchange-type-option-other-connect-icon')).toBeNull();
  });

  it("shows each entry's capability caption under its name", async () => {
    const { getByTestId } = await renderOpenSheet();

    for (const entry of exchangeCatalog) {
      expect(
        within(getByTestId(`exchange-type-option-${entry.id}`)).getByText(i18n.t(entry.captionKey)),
      ).toBeTruthy();
    }

    expect(getByTestId('exchange-type-option-binance').props.accessibilityLabel).toBe(
      'Binance. Connect with a read-only API key.',
    );
    expect(getByTestId('exchange-type-option-btc_wallet').props.accessibilityLabel).toBe(
      'Bitcoin wallet. Connect with a public address.',
    );
    expect(getByTestId('exchange-type-option-other').props.accessibilityLabel).toBe(
      'Other exchange or wallet. Add holdings by hand.',
    );
  });

  it('shows the not-affiliated disclaimer under the trigger whether or not the sheet is open', async () => {
    const view = await renderField();
    const disclaimer = i18n.t('forms.account.exchangeDisclaimer');

    expect(view.getByText(disclaimer)).toBeTruthy();

    await fireEvent.press(view.getByTestId('exchange-type-field'));

    expect(view.getByText(disclaimer)).toBeTruthy();
  });

  it("shows the placeholder until an entry is picked, then the entry's name", async () => {
    const empty = await renderField();

    expect(empty.getByTestId('exchange-type-field')).toHaveTextContent(
      'Select an exchange or wallet',
    );

    const binance = await renderField('binance');
    const wallet = await renderField('btc_wallet');

    expect(binance.getByTestId('exchange-type-field')).toHaveTextContent('Binance');
    expect(wallet.getByTestId('exchange-type-field')).toHaveTextContent(/^Bitcoin wallet$/);
  });

  it('reports the picked id and closes the sheet', async () => {
    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = await renderField(null, { onSelect });

    await fireEvent.press(getByTestId('exchange-type-field'));
    await fireEvent.press(getByTestId('exchange-type-option-btc_wallet'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('btc_wallet');
    expect(queryByTestId('exchange-type-option-btc_wallet')).toBeNull();
  });

  it('opens no sheet when disabled', async () => {
    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = await renderField('binance', {
      onSelect,
      disabled: true,
    });

    expect(getByTestId('exchange-type-field').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(getByTestId('exchange-type-field'));

    expect(queryByTestId('exchange-type-option-other')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
