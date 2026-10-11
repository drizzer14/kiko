import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';
import type { AccountSlice } from '@kiko/statistics/account-contribution';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import PieChart from './pie-chart.component';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

const slices: AccountSlice[] = [
  { accountId: 'a', name: 'Alpha', amount: 800, share: 0.8, color: '#FF375F' },
  { accountId: 'd', name: 'Delta', amount: 30, share: 0.03, color: '#FF9F0A' },
];

// The legend's expand/collapse link as drawn today, pinned so the move onto the shared
// `ExpandToggle` provably changes no pixel.
describe('PieChart legend toggle look', () => {
  it('draws a self-aligned caption accent label beside a caption-sized accent chevron', async () => {
    const { getByTestId } = await render(
      <PieChart slices={slices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    expect(layoutOf(getByTestId('pie-chart-legend-toggle'))).toEqual({
      style: { alignSelf: 'flex-start', paddingVertical: darkTheme.spacing(1) },
      testID: 'pie-chart-legend-toggle',
      children: [
        {
          style: { alignItems: 'center', flexDirection: 'row', gap: darkTheme.spacing(1) },
          children: [
            { variant: 'caption', tone: 'accent', children: ['Show all'] },
            {
              style: { height: darkTheme.iconSizes.caption, width: darkTheme.iconSizes.caption },
              symbol: 'chevron.down',
              tint: darkTheme.colors.accent,
              testID: 'pie-chart-legend-toggle-chevron',
              children: [],
            },
          ],
        },
      ],
    });
  });
});
