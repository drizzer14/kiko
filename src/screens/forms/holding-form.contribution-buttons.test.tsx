import { fireEvent, render, within } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
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

jest.mock('@kiko/holdings/repo', () => ({
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

jest.mock('@kiko/accounts/accounts.repo', () => ({
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
  it('hands the Add contribution button the blue primary treatment at the small size', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));

    const addEntries = mockButtonProps.filter((entry) => entry.children === 'Add contribution');

    expect(addEntries.length).toBeGreaterThan(0);
    // The inline Add is the affirmative "add another contribution" action, so it
    // takes the solid blue `primary` accent fill (on-device review: the faint
    // secondaryTonal tint read too weak for the primary add affordance). It
    // stays the shorter `small` inline size with its leading plus glyph.
    for (const entry of addEntries) {
      expect(entry.variant).toBe('primary');
      expect(entry.size).toBe('small');
      expect(entry.icon).toBe('plus');
    }
  });

  // The mapped contributions and the inline Add button are grouped under ONE
  // container with a tighter inner gap (spacing(2) = 8pt) so the small Add
  // button hugs the list, instead of sitting the section's full spacing(4) =
  // 16pt below it — the disproportionate top-gap fix. theme.spacing(2) === 2*4.
  const TIGHT_GROUP_GAP = 8;

  it('groups the Add contribution button with the contributions under a tighter gap', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));

    const group = screen.getByTestId('contributions-group');

    // The group's own gap is the tighter 8pt rhythm, not the section's 16pt —
    // this is what pulls the Add button up close to the list.
    expect(StyleSheet.flatten(group.props.style).gap).toBe(TIGHT_GROUP_GAP);

    // The Add button lives INSIDE that tight group (hugging the list), no longer
    // a direct sibling sitting the full section gap below the last contribution.
    expect(within(group).getByText('Add contribution')).toBeTruthy();
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
