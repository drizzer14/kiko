import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import ExchangeFields from './exchange-fields.component';

const noop = (): void => {};

// A react-test-renderer JSON node's `children` mixes further nodes and raw text
// leaves; walking only `children` reconstructs the screen-reading order of
// every rendered label/text leaf, so a slot's position can be asserted without
// depending on internal DOM structure.
type RenderedNode = { children: (RenderedNode | string)[] | null };

const collectRenderedText = (node: RenderedNode | string | null): string[] => {
  if (node === null) {
    return [];
  }
  if (typeof node === 'string') {
    return [node];
  }

  return (node.children ?? []).flatMap(collectRenderedText);
};

const setup = async (overrides: Partial<Parameters<typeof ExchangeFields>[0]> = {}) =>
  render(
    <ExchangeFields
      valueOut=""
      onChangeValueOut={noop}
      valueOutSuffix=""
      destinationOptions={[]}
      destinationHoldingId={null}
      onSelectDestination={noop}
      valueIn=""
      onChangeValueIn={noop}
      valueInSuffix=""
      time={0}
      onChangeTime={noop}
      {...overrides}
    />,
  );

describe('ExchangeFields', () => {
  it('renders the Value Out, To, Value In, and Date fields', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Value Out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value In')).toBeTruthy();
    expect(getByLabelText('Date')).toBeTruthy();
  });

  it('renders the modeChipRow slot between the Value In field and the Date field when provided', async () => {
    const { toJSON } = await setup({ modeChipRow: <Text>MODE_CHIP</Text> });

    const rendered = collectRenderedText(toJSON() as unknown as RenderedNode);
    const order = ['Value In', 'MODE_CHIP', 'Date', 'Time'].map((label) => rendered.indexOf(label));

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('renders no slot content in that position when modeChipRow is omitted', async () => {
    const { queryByText } = await setup();

    expect(queryByText('MODE_CHIP')).toBeNull();
  });

  it('shows each leg its own currency glyph as a suffix', async () => {
    const { getByText } = await setup({ valueOutSuffix: '₴', valueInSuffix: '$' });

    // The source leg reads in hryvnia, the destination leg in dollars.
    expect(getByText('₴')).toBeTruthy();
    expect(getByText('$')).toBeTruthy();
  });

  it('shows the "Select holding" placeholder in the destination field', async () => {
    const { getByText } = await setup();

    expect(getByText('Select holding')).toBeTruthy();
  });

  it('marks the three save-gating fields (Value Out, To, Value In) as required', async () => {
    const { getAllByText } = await setup();

    // The Value Out, destination (To), and Value In fields all gate save, so
    // each shows the required asterisk; Date and Time do not.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(3);
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders every field label and the destination placeholder from the Ukrainian catalog', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByText, queryByLabelText } = await setup();

      expect(getByLabelText('Віддано')).toBeTruthy();
      expect(getByLabelText('Куди')).toBeTruthy();
      expect(getByLabelText('Отримано')).toBeTruthy();
      expect(getByLabelText('Дата')).toBeTruthy();
      expect(getByText('Оберіть актив')).toBeTruthy();
      expect(queryByLabelText('Value Out')).toBeNull();
    });
  });
});
