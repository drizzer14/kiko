import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { fieldSuffix } from '@kiko/test-support/field-suffix';

import ShareSection from './share-section.component';

const NO_KEY_HINT = 'Add your EODHD key in Settings → “Share prices” to get prices automatically.';

const baseProps = {
  quoteSource: 'eodhd' as const,
  onSelectQuoteSource: jest.fn(),
  ticker: '',
  onChangeTicker: jest.fn(),
  hasEodhdKey: false,
  isin: '',
  onChangeIsin: jest.fn(),
  showFirstLot: true,
  quantity: '',
  onChangeQuantity: jest.fn(),
  cost: '',
  onChangeCost: jest.fn(),
  currencySuffix: '$',
  purchaseDate: new Date(2026, 8, 15).getTime(),
  onChangePurchaseDate: jest.fn(),
  onSearch: jest.fn().mockResolvedValue({ status: 'ok', listings: [] }),
  onPickListing: jest.fn(),
  onSearchOpenChange: jest.fn(),
};

describe('ShareSection search', () => {
  const vodafone = {
    symbol: 'VOD.LSE',
    name: 'Vodafone Group PLC',
    currency: 'GBP' as const,
    quoteCurrency: 'GBX',
  };

  it('offers a search in EODHD mode once a key is saved', async () => {
    const { getByText } = await render(<ShareSection {...baseProps} hasEodhdKey />);

    expect(getByText('Find by ISIN or ticker')).toBeTruthy();
  });

  it('offers no search without a saved key, only the hint', async () => {
    const { queryByText, getByText } = await render(<ShareSection {...baseProps} />);

    expect(queryByText('Find by ISIN or ticker')).toBeNull();
    expect(getByText(NO_KEY_HINT)).toBeTruthy();
  });

  it('offers no search in manual mode', async () => {
    const { queryByText } = await render(
      <ShareSection {...baseProps} hasEodhdKey quoteSource="manual" />,
    );

    expect(queryByText('Find by ISIN or ticker')).toBeNull();
  });

  it('opens the search sheet and reports that it opened', async () => {
    const onSearchOpenChange = jest.fn();
    const { getByText, queryByText } = await render(
      <ShareSection {...baseProps} hasEodhdKey onSearchOpenChange={onSearchOpenChange} />,
    );

    expect(queryByText('Find Share')).toBeNull();

    await fireEvent.press(getByText('Find by ISIN or ticker'));

    expect(getByText('Find Share')).toBeTruthy();
    expect(onSearchOpenChange).toHaveBeenCalledWith(true);
  });

  it('reports the listing picked in the sheet and closes it', async () => {
    const onPickListing = jest.fn();
    const onSearchOpenChange = jest.fn();
    const onSearch = jest.fn().mockResolvedValue({ status: 'ok', listings: [vodafone] });
    const screen = await render(
      <ShareSection
        {...baseProps}
        hasEodhdKey
        onSearch={onSearch}
        onPickListing={onPickListing}
        onSearchOpenChange={onSearchOpenChange}
      />,
    );

    await fireEvent.press(screen.getByText('Find by ISIN or ticker'));
    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'VOD');
    await fireEvent.press(screen.getByText('Search'));
    await fireEvent.press(screen.getByTestId('share-search-option-VOD.LSE'));

    expect(onSearch).toHaveBeenCalledWith('VOD');
    expect(onPickListing).toHaveBeenCalledWith(vodafone);
    expect(onSearchOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Find Share')).toBeNull();
  });
});

describe('ShareSection price source', () => {
  it.each([true, false])(
    'always offers both EODHD and Manual under a Price source label (key saved: %s)',
    async (hasEodhdKey) => {
      const { getByText } = await render(<ShareSection {...baseProps} hasEodhdKey={hasEodhdKey} />);

      expect(getByText('Price source')).toBeTruthy();
      expect(getByText('EODHD')).toBeTruthy();
      expect(getByText('Manual')).toBeTruthy();
    },
  );

  it('reports the tapped price source', async () => {
    const onSelectQuoteSource = jest.fn();
    const { getByText } = await render(
      <ShareSection {...baseProps} onSelectQuoteSource={onSelectQuoteSource} />,
    );

    await fireEvent.press(getByText('Manual'));

    expect(onSelectQuoteSource).toHaveBeenCalledWith('manual');
  });
});

describe('ShareSection ticker', () => {
  it('shows the required ticker field in EODHD mode', async () => {
    const { getByLabelText } = await render(<ShareSection {...baseProps} />);

    expect(getByLabelText('Ticker').props.placeholder).toBe('AAPL.US');
  });

  it('hides the ticker field in manual mode', async () => {
    const { queryByLabelText } = await render(<ShareSection {...baseProps} quoteSource="manual" />);

    expect(queryByLabelText('Ticker')).toBeNull();
  });

  it('shows the ticker error it is handed', async () => {
    const { getByText } = await render(
      <ShareSection {...baseProps} tickerError="Enter a ticker, for example AAPL.US." />,
    );

    expect(getByText('Enter a ticker, for example AAPL.US.')).toBeTruthy();
  });
});

describe('ShareSection no-key hint', () => {
  it('points to Settings in EODHD mode with no saved key', async () => {
    const { getByText } = await render(<ShareSection {...baseProps} />);

    expect(getByText(NO_KEY_HINT)).toBeTruthy();
  });

  it('shows no hint once a key is saved', async () => {
    const { queryByText } = await render(<ShareSection {...baseProps} hasEodhdKey />);

    expect(queryByText(NO_KEY_HINT)).toBeNull();
  });

  it('shows no hint in manual mode', async () => {
    const { queryByText } = await render(<ShareSection {...baseProps} quoteSource="manual" />);

    expect(queryByText(NO_KEY_HINT)).toBeNull();
  });
});

describe('ShareSection ISIN and first lot', () => {
  it('shows an optional ISIN field in both modes', async () => {
    const eodhd = await render(<ShareSection {...baseProps} />);
    expect(eodhd.getByLabelText('ISIN')).toBeTruthy();

    const manual = await render(<ShareSection {...baseProps} quoteSource="manual" />);
    expect(manual.getByLabelText('ISIN')).toBeTruthy();
  });

  it('shows the first-lot fields with the currency after the total cost', async () => {
    const screen = await render(<ShareSection {...baseProps} />);

    expect(screen.getByLabelText('Quantity')).toBeTruthy();
    expect(fieldSuffix(screen.getByLabelText('Total cost'))).toBe('$');
    expect(screen.getByLabelText('Purchase date')).toBeTruthy();
  });

  it('hides the first-lot fields when told to', async () => {
    const { queryByLabelText } = await render(<ShareSection {...baseProps} showFirstLot={false} />);

    expect(queryByLabelText('Quantity')).toBeNull();
    expect(queryByLabelText('Total cost')).toBeNull();
    expect(queryByLabelText('Purchase date')).toBeNull();
  });
});
