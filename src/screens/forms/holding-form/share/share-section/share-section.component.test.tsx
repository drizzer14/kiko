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
};

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
