import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../../design-system/unistyles';
import '../../../i18n';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Overrides
// ONLY `useAnimatedRef` — see the module for the full rationale.
import { mockReanimatedScrollToEnd } from '../../../test-support/mock-reanimated-scroll-to-end';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';

import HoldingFormScreen from './holding-form.screen';

const mockScrollToEnd = jest.fn();

jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd));

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    create: jest.fn().mockResolvedValue('new-holding-id'),
    setIcon: jest.fn(),
    update: jest.fn(),
    updateWithBalanceDelta: jest.fn(),
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

jest.mock('../../../db/use-live-query', () => ({
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
  mockScrollToEnd.mockClear();
});

describe('HoldingFormScreen contribution scroll-on-add', () => {
  it('scrolls the ScrollView to the newly added contribution when Add contribution is pressed', async () => {
    // The scroll is deferred to the next frame so the just-added row is
    // measured first; run that frame synchronously to assert the effect (same
    // pattern as the categories screen's own deferred scroll-to-form test).
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    mockScrollToEnd.mockClear();
    await fireEvent.press(screen.getByText('Add contribution'));

    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

    rafSpy.mockRestore();
  });
});
