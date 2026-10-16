import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { type StyleProp, StyleSheet, Text as RNText, type TextStyle } from 'react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { type LayoutNode, layoutOf } from '@kiko/test-support/layout-of';

import EntryCard from '.';

// Like the shared `mock-text-variant-tone` Text mock, but it also forwards `style` as a host
// prop, because this file pins a footer line's `textAlign`. A getter, so the mock is read when
// `Text` is first used, after its declaration ran.
const mockTextWithStyle = ({
  variant = 'body',
  tone = 'textPrimary',
  style,
  children,
}: {
  variant?: string;
  tone?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}) => <RNText {...{ variant, tone, style }}>{children}</RNText>;

jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextWithStyle;
  },
}));

const amount = <RNText testID="amount">42</RNText>;

const labelLayout = (label: string): LayoutNode => ({
  style: { flex: 1, marginRight: darkTheme.spacing(3) },
  children: [{ variant: 'body', tone: 'textPrimary', children: [label] }],
});

const amountLayout: LayoutNode = {
  style: { flexShrink: 0 },
  children: [{ testID: 'amount', children: ['42'] }],
};

const mainRowLayout = (children: LayoutNode[]): LayoutNode => ({
  style: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  children,
});

const footerLayout = (lines: string[]): LayoutNode => ({
  style: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  children: lines.map((line) => ({
    style: { textAlign: 'right' },
    variant: 'caption',
    tone: 'textSecondary',
    children: [line],
  })),
});

const cardLayout = (children: LayoutNode[], testID = 'entry'): LayoutNode => ({
  style: expect.objectContaining({
    padding: darkTheme.spacing(3),
    borderRadius: darkTheme.radii.md,
  }),
  testID,
  children: [{ style: { gap: darkTheme.spacing(1) }, children }],
});

describe('EntryCard', () => {
  it('draws the label left and the amount right on one row, with no footer by default', async () => {
    const { getByTestId } = await render(
      <EntryCard testID="entry" label="Loan payment" amount={amount} />,
    );

    expect(layoutOf(getByTestId('entry'))).toEqual(
      cardLayout([mainRowLayout([labelLayout('Loan payment'), amountLayout])]),
    );
  });

  it('draws no footer for an empty footerLines list', async () => {
    const { getByTestId } = await render(
      <EntryCard testID="entry" label="Loan payment" amount={amount} footerLines={[]} />,
    );

    expect(layoutOf(getByTestId('entry'))).toEqual(
      cardLayout([mainRowLayout([labelLayout('Loan payment'), amountLayout])]),
    );
  });

  it('draws one right-aligned caption footer line', async () => {
    const { getByTestId } = await render(
      <EntryCard testID="entry" label="Interest" amount={amount} footerLines={['Computed']} />,
    );

    expect(layoutOf(getByTestId('entry'))).toEqual(
      cardLayout([
        mainRowLayout([labelLayout('Interest'), amountLayout]),
        footerLayout(['Computed']),
      ]),
    );
  });

  it('draws several footer lines in order, each right-flush', async () => {
    const { getByTestId } = await render(
      <EntryCard
        testID="entry"
        label="Loan payment"
        amount={amount}
        footerLines={['Scheduled', 'Principal 1 · interest 2']}
      />,
    );

    expect(layoutOf(getByTestId('entry'))).toEqual(
      cardLayout([
        mainRowLayout([labelLayout('Loan payment'), amountLayout]),
        footerLayout(['Scheduled', 'Principal 1 · interest 2']),
      ]),
    );
  });

  it('puts a lead beside the label inside one leading cluster, before the amount', async () => {
    const { getByTestId } = await render(
      <EntryCard
        testID="entry"
        label="Coffee"
        amount={amount}
        lead={<RNText testID="lead">icon</RNText>}
      />,
    );

    expect(layoutOf(getByTestId('entry'))).toEqual(
      cardLayout([
        mainRowLayout([
          {
            style: {
              alignItems: 'flex-start',
              flex: 1,
              flexDirection: 'row',
              gap: darkTheme.spacing(2),
            },
            children: [{ testID: 'lead', children: ['icon'] }, labelLayout('Coffee')],
          },
          amountLayout,
        ]),
      ]),
    );
  });

  it('forwards its style to the card', async () => {
    const { getByTestId } = await render(
      <EntryCard testID="entry" label="Coffee" amount={amount} style={{ opacity: 0.5 }} />,
    );

    expect(StyleSheet.flatten(getByTestId('entry').props.style)).toMatchObject({ opacity: 0.5 });
  });
});
