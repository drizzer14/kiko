import { i18n } from '@kiko/i18n/init';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import ExpandToggle from '.';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

const toggleLayout = (label: string, chevron: string, testID: string) => ({
  style: { alignSelf: 'flex-start', paddingVertical: darkTheme.spacing(1) },
  testID,
  children: [
    {
      style: { alignItems: 'center', flexDirection: 'row', gap: darkTheme.spacing(1) },
      children: [
        { variant: 'caption', tone: 'accent', children: [label] },
        {
          style: { height: darkTheme.iconSizes.caption, width: darkTheme.iconSizes.caption },
          symbol: chevron,
          tint: darkTheme.colors.accent,
          testID: `${testID}-chevron`,
          children: [],
        },
      ],
    },
  ],
});

describe('ExpandToggle', () => {
  it('draws "Show all" beside a down chevron while collapsed', async () => {
    const { getByTestId } = await render(
      <ExpandToggle expanded={false} onPress={jest.fn()} testID="toggle" />,
    );

    expect(layoutOf(getByTestId('toggle'))).toEqual(
      toggleLayout(i18n.t('components.pieChart.showAll'), 'chevron.down', 'toggle'),
    );
  });

  it('draws "Show less" beside an up chevron while expanded', async () => {
    const { getByTestId } = await render(
      <ExpandToggle expanded onPress={jest.fn()} testID="toggle" />,
    );

    expect(layoutOf(getByTestId('toggle'))).toEqual(
      toggleLayout(i18n.t('components.pieChart.showLess'), 'chevron.up', 'toggle'),
    );
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ExpandToggle expanded={false} onPress={onPress} testID="toggle" />,
    );

    await fireEvent.press(getByTestId('toggle'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a button that announces whether it is expanded', async () => {
    const { getByTestId, rerender } = await render(
      <ExpandToggle expanded={false} onPress={jest.fn()} testID="toggle" />,
    );

    expect(getByTestId('toggle').props.accessibilityRole).toBe('button');
    expect(getByTestId('toggle').props.accessibilityState).toEqual({ expanded: false });

    await rerender(<ExpandToggle expanded onPress={jest.fn()} testID="toggle" />);

    expect(getByTestId('toggle').props.accessibilityState).toEqual({ expanded: true });
  });

  // The caption line plus its padding sits below the 44pt floor, and nothing neighbours it
  // within reach, so vertical hitSlop restores it.
  it('reaches a 44pt tap target through its padding and hit slop', async () => {
    const { getByTestId } = await render(
      <ExpandToggle expanded={false} onPress={jest.fn()} testID="toggle" />,
    );
    const { top, bottom } = getByTestId('toggle').props.hitSlop;

    expect(
      darkTheme.iconSizes.caption + 2 * darkTheme.spacing(1) + top + bottom,
    ).toBeGreaterThanOrEqual(44);
  });
});
