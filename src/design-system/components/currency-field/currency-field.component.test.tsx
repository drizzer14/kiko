import { fireEvent, render } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import '../../unistyles';
// Real i18n init (side effect), same as App.tsx. Previously reached only by
// accident through GlassSurface -> screenshot-mode -> i18n before the 5.6
// screenshot-subsystem strip removed that import chain; now imported directly
// so the search placeholder's `t(...)` resolves under test the same way it
// does at runtime.
import '../../../i18n';
import { fiatCurrencyOptions } from '../../../currency/currency';

import CurrencyField from '.';

const open = async (utils: Awaited<ReturnType<typeof render>>): Promise<void> => {
  await fireEvent.press(utils.getByTestId('currency-field'));
};

const search = async (utils: Awaited<ReturnType<typeof render>>, query: string): Promise<void> => {
  await fireEvent.changeText(utils.getByPlaceholderText('Search by code or name'), query);
};

describe('CurrencyField', () => {
  it('reports the picked currency and closes the sheet', async () => {
    const onSelect = jest.fn();
    const utils = await render(
      <CurrencyField label="Currency" selected="UAH" onSelect={onSelect} testID="currency-field" />,
    );
    await open(utils);
    // Narrow by search first: unfiltered, USD sorts alphabetically by its
    // localized name ("US Dollar") well outside the FlatList's virtualized
    // initial window (`initialNumToRender={15}`).
    await search(utils, 'USD');
    await fireEvent.press(utils.getByTestId('currency-option-USD'));
    expect(onSelect).toHaveBeenCalledWith('USD');
  });

  it('filters the list by code', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'chf');
    expect(utils.getByTestId('currency-option-CHF')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('filters the list by name', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'pound');
    expect(utils.getByTestId('currency-option-GBP')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-EUR')).toBeNull();
  });

  it('restricts the list to the given options (fiat only offers no BTC)', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={fiatCurrencyOptions}
        testID="currency-field"
      />,
    );
    await open(utils);
    // Narrow by search: unfiltered, USD sorts near the end of the alphabetized
    // fiat list and falls outside the FlatList's virtualized initial window.
    await search(utils, 'USD');
    expect(utils.queryByTestId('currency-option-BTC')).toBeNull();
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  it('shows the text currency mark for the trigger and each option (never a generic icon)', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="USD"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );

    // The trigger's own leading mark ("$" for USD) — proves CurrencyField
    // swapped from the SF Symbol `icon` path onto the text `leadingText` path.
    expect(utils.getByText('$')).toBeTruthy();

    await open(utils);
    // AED has no conventional Unicode symbol, so its mark is the bare ISO
    // code — this is exactly the case the old SF-Symbol map fell back to the
    // generic `banknote` glyph for. Narrow by search first: unfiltered, AED's
    // localized name ("UAE Dirham") sorts outside the virtualized window.
    await search(utils, 'AED');

    expect(utils.getByTestId('currency-option-AED')).toBeTruthy();
  });

  // DEVICE BUG: the search TextField inside the sheet leaves the keyboard up
  // (and the background form scrolled) after a currency is picked, because
  // neither `handleSelect` nor the sheet's dismiss ever called
  // `Keyboard.dismiss()`.
  it('dismisses the keyboard when a currency is selected', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'USD');
    await fireEvent.press(utils.getByTestId('currency-option-USD'));

    expect(dismissSpy).toHaveBeenCalled();

    dismissSpy.mockRestore();
  });

  // Same device bug: dismissing the sheet WITHOUT picking a currency (the
  // scrim/back dismiss) must also drop the keyboard, or a search left focused
  // keeps the background scrolled even after the sheet itself closes.
  it('dismisses the keyboard when the sheet is dismissed without a selection', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await fireEvent.press(utils.getByTestId('currency-picker-sheet-backdrop'));

    expect(dismissSpy).toHaveBeenCalled();

    dismissSpy.mockRestore();
  });

  it('does not open the sheet when disabled', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="BTC"
        onSelect={jest.fn()}
        disabled
        testID="currency-field"
      />,
    );
    await open(utils);
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('pins UAH first in the fiat group when the search box is empty', async () => {
    // ARS ("Argentine Peso") sorts alphabetically before UAH ("Ukrainian
    // Hryvnia") — restricting `options` to just these two isolates the pin
    // from the rest of the fiat set: if UAH were merely sorted in like any
    // other fiat, ARS would render first.
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={['ARS', 'UAH']}
        testID="currency-field"
      />,
    );
    await open(utils);

    const rows = utils.getAllByTestId(/^currency-option-/);
    expect(rows[0]).toHaveProp('accessibilityLabel', 'UAH Ukrainian Hryvnia');
  });

  it('does not force-pin UAH first while a search is active', async () => {
    // Same ARS/UAH pair, but this time both rows match the search query
    // ("a" is in both "ARS"/"Argentine Peso" and "UAH"/"Ukrainian Hryvnia") —
    // if the pin were still applied during a search, UAH would render first
    // despite ARS sorting first alphabetically by name.
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={['ARS', 'UAH']}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'a');

    const rows = utils.getAllByTestId(/^currency-option-/);
    expect(rows[0]).toHaveProp('accessibilityLabel', 'ARS Argentine Peso');
  });

  it('sorts fiat currencies alphabetically by localized name, not by ISO code', async () => {
    // DZD ("Algerian Dinar") vs AOA ("Angolan Kwanza"): the ISO codes sort
    // AOA before DZD, but the localized names sort the other way round
    // ("Algerian" < "Angolan") — the two orders DISAGREE, so DZD rendering
    // before AOA proves the list is sorted by name, not by code.
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="DZD"
        onSelect={jest.fn()}
        options={['AOA', 'DZD']}
        testID="currency-field"
      />,
    );
    await open(utils);

    const rows = utils.getAllByTestId(/^currency-option-/);
    expect(rows[0]).toHaveProp('accessibilityLabel', 'DZD Algerian Dinar');
    expect(rows[1]).toHaveProp('accessibilityLabel', 'AOA Angolan Kwanza');
  });

  it('groups crypto (BTC, ETH, USDT) after every fiat currency, sorted alphabetically within itself', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={['USDT', 'UAH', 'ETH', 'BTC']}
        testID="currency-field"
      />,
    );
    await open(utils);

    const rows = utils.getAllByTestId(/^currency-option-/);
    const labels = rows.map((row) => row.props.accessibilityLabel as string);

    // The lone fiat currency (UAH) comes first, then the crypto trio —
    // alphabetically by localized name (Bitcoin, Ethereum, Tether), never in
    // the `options` array's own order.
    expect(labels).toEqual(['UAH Ukrainian Hryvnia', 'BTC Bitcoin', 'ETH Ethereum', 'USDT Tether']);
  });

  it('finds a currency by searching its ISO code', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'USD');
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
    expect(utils.getByText('US Dollar')).toBeTruthy();
  });

  it('finds a currency by searching its localized name', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'dollar');
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  // DEVICE BUG (review, 2026-09-14): the trigger's own displayed value used
  // to read "CODE — Name" (e.g. "USD — US Dollar"), duplicating the ISO code
  // that already sits in the trigger's separate `leadingText` mark. The
  // trigger must mirror the option rows exactly: the localized NAME only.
  it('does not show the ISO code in the trigger value, only the localized name', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="USD"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );

    expect(utils.getByText('US Dollar')).toBeTruthy();
    expect(utils.queryByText('USD — US Dollar')).toBeNull();
  });

  it('does not show the ISO code in the visible row label', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await search(utils, 'USD');

    // The visible row text is just the localized name…
    expect(utils.getByText('US Dollar')).toBeTruthy();
    // …never the old "USD — US Dollar"/bare "USD" combined row label. (The
    // accessibility label still carries the code — asserted separately above
    // via `currency-option-USD` — so this only proves the ISO code is gone
    // from the visible, on-screen text.)
    expect(utils.queryByText('USD — US Dollar')).toBeNull();
    expect(utils.queryByText('USD')).toBeNull();
  });
});
