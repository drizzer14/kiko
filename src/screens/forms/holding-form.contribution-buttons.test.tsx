import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import '../../design-system/unistyles';
import '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import HoldingFormScreen from './holding-form.screen';

// The Button variant maps to a themed fill inside a react-native-unistyles
// `variants` block, which the project's Jest mock strips out of the resolved
// style, and RTL 14's renderer exposes only the host tree (never a composite
// component's props). So neither the fill nor the `variant` prop is observable
// on the rendered output. The `variant` -> color contract is proven by the
// Button component's own tests; this file proves the wiring — that the screen
// hands the Add/Remove contribution controls the intended variant — by mocking
// Button to record the `variant` it receives.
const mockButtonProps: {
  variant?: string;
  size?: string;
  icon?: string;
  children: ReactNode;
  accessibilityLabel?: string;
}[] = [];

jest.mock('../../design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: (props: {
      variant?: string;
      size?: string;
      icon?: string;
      children: ReactNode;
      accessibilityLabel?: string;
      onPress: () => void;
    }) => {
      mockButtonProps.push({
        variant: props.variant,
        size: props.size,
        icon: props.icon,
        children: props.children,
        accessibilityLabel: props.accessibilityLabel,
      });

      return (
        <Pressable accessibilityLabel={props.accessibilityLabel} onPress={props.onPress}>
          <RNText>{props.children}</RNText>
        </Pressable>
      );
    },
  };
});

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    create: jest.fn().mockResolvedValue('new-holding-id'),
    setIcon: jest.fn(),
    update: jest.fn(),
    updateWithBalanceDelta: jest.fn(),
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

jest.mock('../../db/use-live-query', () => ({
  // A bank account, so the create form defaults to a term deposit and renders
  // the contributions block with its Add/Remove controls.
  useLiveQuery: (_query: unknown, keys: string[]) =>
    keys[0] === 'holdings'
      ? { data: [] }
      : { data: [{ id: 'acc-1', kind: 'bank', institution: null }] },
}));

jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: { byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

type HoldingFormProps = ComponentProps<typeof HoldingFormScreen>;

const navigation = navigationSpy();
const route = asRouteProp<HoldingFormProps['route']>('HoldingForm', { accountId: 'acc-1' });

const renderScreen = () =>
  render(
    <HoldingFormScreen
      navigation={asNavigationProp<HoldingFormProps['navigation']>(navigation)}
      route={route}
    />,
  );

beforeEach(() => {
  mockButtonProps.length = 0;
});

describe('HoldingFormScreen contribution button variants', () => {
  it('hands the Add contribution button the small faint-tint secondaryTonal treatment', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));

    const addEntries = mockButtonProps.filter((entry) => entry.children === 'Add contribution');

    expect(addEntries.length).toBeGreaterThan(0);
    // The inline Add is a lower-emphasis secondary of the form's Save CTA, so it
    // takes the faint neutral tint (secondaryTonal) at the shorter `small` size,
    // with a leading plus glyph — no longer the solid blue `primary` fill.
    for (const entry of addEntries) {
      expect(entry.variant).toBe('secondaryTonal');
      expect(entry.size).toBe('small');
      expect(entry.icon).toBe('plus');
    }
  });

  it('hands each Remove contribution button the tinted destructiveTonal variant', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    // A second row makes the per-row Remove control appear on every row.
    await fireEvent.press(screen.getByText('Add contribution'));

    const removeEntries = mockButtonProps.filter((entry) =>
      String(entry.accessibilityLabel ?? '').startsWith('Remove contribution'),
    );

    expect(removeEntries.length).toBeGreaterThan(0);
    // The per-row Remove uses the subtler tinted-destructive variant (a
    // translucent red tint under a red label), not the solid bright
    // `destructive` fill (on-device review: the solid fill read too bright). It
    // is the shared small faint-tint treatment with a trash glyph — the SAME
    // shape the categories Delete reuses (categories.screen.tsx).
    for (const entry of removeEntries) {
      expect(entry.variant).toBe('destructiveTonal');
      expect(entry.size).toBe('small');
      expect(entry.icon).toBe('trash');
    }
  });
});
