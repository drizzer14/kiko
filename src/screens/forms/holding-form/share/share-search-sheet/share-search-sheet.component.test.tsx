import { act, fireEvent, render } from '@testing-library/react-native';
import type { ShareListing, ShareSearchResult } from '@kiko/prices/share-search';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import ShareSearchSheet from './share-search-sheet.component';
import type { ShareSearchSheetProps } from './share-search-sheet.props';

// The Search button's own onPress, so a test can press it twice inside one
// act, before any re-render could disable it.
let mockSearchPress: () => void = () => undefined;
jest.mock('@kiko/design-system/components/button', () => {
  const { createElement } = jest.requireActual('react');
  const { default: Button } = jest.requireActual('@kiko/design-system/components/button');

  return {
    __esModule: true,
    default: (props: { testID?: string; onPress: () => void }) => {
      if (props.testID === 'share-search-submit') {
        mockSearchPress = props.onPress;
      }

      return createElement(Button, props);
    },
  };
});

const UNAVAILABLE = 'Search is unavailable. Enter the ticker yourself.';
const QUOTA_EXHAUSTED =
  'Today’s EODHD requests are used up. Search works again after midnight GMT.';

const vodafone: ShareListing = {
  symbol: 'VOD.LSE',
  name: 'Vodafone Group PLC',
  isin: 'GB00BH4HKS39',
  currency: 'GBP',
  quoteCurrency: 'GBX',
};

const apple: ShareListing = {
  symbol: 'AAPL.US',
  name: 'Apple Inc',
  isin: 'US0378331005',
  currency: 'USD',
  quoteCurrency: 'USD',
};

const answering = (result: ShareSearchResult) => jest.fn().mockResolvedValue(result);

const renderSheet = (overrides: Partial<ShareSearchSheetProps> = {}) =>
  render(
    <ShareSearchSheet
      visible
      onDismiss={jest.fn()}
      search={answering({ status: 'ok', listings: [vodafone, apple] })}
      onPick={jest.fn()}
      {...overrides}
    />,
  );

type Rendered = Awaited<ReturnType<typeof renderSheet>>;

const searchFor = async (screen: Rendered, query: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), query);
  await fireEvent.press(screen.getByText('Search'));
};

describe('ShareSearchSheet', () => {
  it('shows its title and an ISIN or ticker field', async () => {
    const screen = await renderSheet();

    expect(screen.getByText('Find Share')).toBeTruthy();
    expect(screen.getByLabelText('ISIN or ticker').props.placeholder).toBe('US0378331005');
  });

  it('asks nothing while the query is typed, and once per Search press', async () => {
    const search = answering({ status: 'ok', listings: [vodafone] });
    const screen = await renderSheet({ search });

    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'V');
    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'VO');
    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'VOD ');

    expect(search).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Search'));

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('VOD');
  });

  it('asks once for two presses of Search in one tick', async () => {
    let resolveSearch: (result: ShareSearchResult) => void = () => undefined;
    const search = jest.fn(
      () =>
        new Promise<ShareSearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const screen = await renderSheet({ search });

    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'VOD');
    await act(async () => {
      mockSearchPress();
      mockSearchPress();
    });

    expect(search).toHaveBeenCalledTimes(1);

    resolveSearch({ status: 'ok', listings: [vodafone] });

    expect(await screen.findByText('Vodafone Group PLC')).toBeTruthy();
  });

  it('asks nothing for a blank query', async () => {
    const search = answering({ status: 'ok', listings: [] });
    const screen = await renderSheet({ search });

    await searchFor(screen, '   ');

    expect(search).not.toHaveBeenCalled();
  });

  it('lists each listing by name, with its symbol and price unit', async () => {
    const screen = await renderSheet();

    await searchFor(screen, 'VOD');

    expect(screen.getByText('Vodafone Group PLC')).toBeTruthy();
    expect(screen.getByText('VOD.LSE · GBX')).toBeTruthy();
    expect(screen.getByText('Apple Inc')).toBeTruthy();
    expect(screen.getByText('AAPL.US · USD')).toBeTruthy();
  });

  it('reports the picked listing', async () => {
    const onPick = jest.fn();
    const screen = await renderSheet({ onPick });

    await searchFor(screen, 'VOD');
    await fireEvent.press(screen.getByTestId('share-search-option-VOD.LSE'));

    expect(onPick).toHaveBeenCalledWith(vodafone);
  });

  it('says when nothing was found', async () => {
    const screen = await renderSheet({ search: answering({ status: 'ok', listings: [] }) });

    await searchFor(screen, 'ZZZZ');

    expect(screen.getByText('Nothing found.')).toBeTruthy();
  });

  it.each<ShareSearchResult>([{ status: 'failed' }, { status: 'noKey' }])(
    'points to typing the ticker when the search fails (%o)',
    async (result) => {
      const screen = await renderSheet({ search: answering(result) });

      await searchFor(screen, 'VOD');

      expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    },
  );

  it('points to typing the ticker when the search cannot run at all', async () => {
    const screen = await renderSheet({ search: jest.fn().mockRejectedValue(new Error('db')) });

    await searchFor(screen, 'VOD');

    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
  });

  it('says when the day’s EODHD requests are used up', async () => {
    const screen = await renderSheet({ search: answering({ status: 'quotaExhausted' }) });

    await searchFor(screen, 'VOD');

    expect(screen.getByText(QUOTA_EXHAUSTED)).toBeTruthy();
  });

  it('starts empty each time it opens', async () => {
    const screen = await renderSheet();

    await searchFor(screen, 'VOD');
    await screen.rerender(
      <ShareSearchSheet
        visible={false}
        onDismiss={jest.fn()}
        search={jest.fn()}
        onPick={jest.fn()}
      />,
    );
    await screen.rerender(
      <ShareSearchSheet visible onDismiss={jest.fn()} search={jest.fn()} onPick={jest.fn()} />,
    );

    expect(screen.getByLabelText('ISIN or ticker').props.value).toBe('');
    expect(screen.queryByText('Vodafone Group PLC')).toBeNull();
  });

  it('hides the previous results while a new search runs', async () => {
    const search = jest
      .fn<Promise<ShareSearchResult>, [string]>()
      .mockResolvedValueOnce({ status: 'ok', listings: [vodafone] })
      .mockReturnValueOnce(new Promise<ShareSearchResult>(() => undefined));
    const screen = await renderSheet({ search });

    await searchFor(screen, 'VOD');
    expect(await screen.findByText('Vodafone Group PLC')).toBeTruthy();

    await searchFor(screen, 'AAPL');

    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Vodafone Group PLC')).toBeNull();
  });

  it('drops an answer that arrives after the sheet closed', async () => {
    let resolveSearch: (result: ShareSearchResult) => void = () => undefined;
    const search = jest.fn(
      () =>
        new Promise<ShareSearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const screen = await renderSheet({ search });

    await fireEvent.changeText(screen.getByLabelText('ISIN or ticker'), 'VOD');
    await fireEvent.press(screen.getByText('Search'));
    await screen.rerender(
      <ShareSearchSheet visible={false} onDismiss={jest.fn()} search={search} onPick={jest.fn()} />,
    );
    await act(async () => {
      resolveSearch({ status: 'ok', listings: [vodafone] });
    });
    await screen.rerender(
      <ShareSearchSheet visible onDismiss={jest.fn()} search={search} onPick={jest.fn()} />,
    );

    expect(screen.queryByText('Vodafone Group PLC')).toBeNull();
  });
});
