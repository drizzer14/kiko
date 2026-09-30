import { Text as RNText, StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import Card from '@kiko/design-system/components/card';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import SettingsRow from './settings-row.component';

describe('SettingsRow', () => {
  it('renders its label', async () => {
    const { getByText } = await render(<SettingsRow label="Base currency" />);
    expect(getByText('Base currency')).toBeTruthy();
  });

  it('renders a trailing chevron only when the row navigates (onPress given)', async () => {
    const { queryByTestId } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    // The chevron is hidden from the a11y tree, so it is only reachable with
    // `includeHiddenElements`.
    expect(queryByTestId('settings-row-chevron', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders no trailing chevron for a non-navigating row', async () => {
    const { queryByTestId } = await render(<SettingsRow label="Base currency" />);
    expect(queryByTestId('settings-row-chevron', { includeHiddenElements: true })).toBeNull();
  });

  // The chevron previously fell back to SymbolIcon's default
  // `iconSizes.body` (fontSize * 1.25), which renders LARGER than the row's
  // own title. It must instead match the title's
  // fontSize (the label's `variant="body"` Text) exactly.
  it("sizes the trailing chevron to match the row title's own fontSize, not the larger default icon size", async () => {
    const { root } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);

    const chevronGlyphs = root?.queryAll((node) => node.props.name === 'chevron.right') ?? [];
    expect(chevronGlyphs).toHaveLength(1);
    expect(chevronGlyphs[0].props.size).toBe(darkTheme.typography.body.fontSize);
    // Guards the premise: this must be a real shrink, not a no-op equal to
    // the old default.
    expect(chevronGlyphs[0].props.size).not.toBe(darkTheme.iconSizes.body);
  });

  it('hides the decorative chevron from the accessibility tree', async () => {
    const { getByTestId } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    const chevron = getByTestId('settings-row-chevron', { includeHiddenElements: true });
    expect(chevron.props.accessibilityElementsHidden).toBe(true);
  });

  // Shrinking the chevron to the title's font size left it (now shorter)
  // top-aligned by the header's `flex-start`, so it rode ABOVE the title's
  // center. Its own box now carries the row's first-line
  // height (the leading icon's size) and centers the glyph, so it lands on the
  // title's center while `flex-start` still keeps it on the first line on wrap.
  it("centers the trailing chevron on the title's first line, not top-aligned above it", async () => {
    const { getByTestId } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    const chevron = getByTestId('settings-row-chevron', { includeHiddenElements: true });
    const chevronStyle = StyleSheet.flatten(chevron.props.style);

    expect(chevronStyle.height).toBe(darkTheme.iconSizes.body);
    expect(chevronStyle.justifyContent).toBe('center');
  });

  it('calls onPress when a navigating row is pressed', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<SettingsRow label="Categories" onPress={onPress} />);
    await fireEvent.press(getByText('Categories'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not itself a pressable when it has no onPress, so it never swallows a child press', async () => {
    const { queryByRole } = await render(
      <SettingsRow label="Base currency">
        <RNText>child content</RNText>
      </SettingsRow>,
    );
    expect(queryByRole('button')).toBeNull();
  });

  // Two rows must stay two INDEPENDENT pressables, never one shared box with
  // two actions baked into a single tap target (the old boxed side-by-side
  // button block). Each setting now sits in its own card, but a row must never
  // swallow a sibling row's press regardless of how they are grouped.
  it('renders as independently pressable rows, never one shared box', async () => {
    const onPressFirst = jest.fn();
    const onPressSecond = jest.fn();
    const { getByText, getAllByRole } = await render(
      <Card>
        <SettingsRow label="First" onPress={onPressFirst} />
        <SettingsRow label="Second" onPress={onPressSecond} />
      </Card>,
    );

    expect(getAllByRole('button')).toHaveLength(2);

    await fireEvent.press(getByText('First'));
    expect(onPressFirst).toHaveBeenCalledTimes(1);
    expect(onPressSecond).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Second'));
    expect(onPressSecond).toHaveBeenCalledTimes(1);
    expect(onPressFirst).toHaveBeenCalledTimes(1);
  });

  // A long label ("Follow system setting"-length strings elsewhere in
  // Settings) previously overflowed past the trailing chevron/control instead
  // of wrapping, because RN's `flexShrink` defaults to 0. This asserts the
  // STYLE CONTRACT that enables wrapping (not actual pixel wrapping, which
  // Jest cannot lay out): the label sits in a `flexShrink: 1` container, and
  // the header top-aligns to the label's first line rather than vertically
  // centering the chevron against the label's full (once wrapped,
  // multi-line) height.
  it('lets a long label shrink to wrap, and top-aligns the header to it', async () => {
    const { getByText } = await render(
      <SettingsRow
        icon="gearshape"
        label="A very long setting label that must wrap"
        onPress={jest.fn()}
      />,
    );

    const label = getByText('A very long setting label that must wrap');

    const shrinkable = ancestorWithStyle(label, 'flexShrink');
    expect(StyleSheet.flatten(shrinkable.props.style).flexShrink).toBe(1);

    const header = ancestorWithStyle(label, 'alignItems');
    expect(StyleSheet.flatten(header.props.style).alignItems).toBe('flex-start');
  });

  // A toggle reads as ONE row with its label (label left, control right),
  // not stacked below it the way a picker or segmented control's
  // `children` is.
  it('renders `trailing` inline on the same line as the label, not stacked below it', async () => {
    const { getByText, getByTestId } = await render(
      <SettingsRow
        label="Include saved passwords & keys"
        trailing={<RNText testID="trailing-switch">toggle</RNText>}
      >
        <RNText>Hint text below the row</RNText>
      </SettingsRow>,
    );

    expect(getByText('Include saved passwords & keys')).toBeTruthy();
    expect(getByTestId('trailing-switch')).toBeTruthy();
    expect(getByText('Hint text below the row')).toBeTruthy();
  });

  it('centers the switch and chevron of a pressable row on its label and body together', async () => {
    const { getByTestId } = await render(
      <SettingsRow
        icon="bell"
        label="Add transactions"
        onPress={jest.fn()}
        trailing={<RNText testID="trailing-switch">toggle</RNText>}
        accessibilityActions={[{ name: 'toggle', label: 'Turn off' }]}
        onAccessibilityAction={jest.fn()}
      >
        <RNText testID="row-body">Every day at 20:00</RNText>
      </SettingsRow>,
    );

    const row = ancestorWithStyle(getByTestId('trailing-switch'), 'alignItems');

    expect(StyleSheet.flatten(row.props.style).alignItems).toBe('center');
    expect(within(row).getByTestId('row-body')).toBeTruthy();
    expect(
      within(row).getByTestId('settings-row-chevron', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('sets the chevron one spacing step clear of a switch, and adds no gutter after a label', async () => {
    const withSwitch = await render(
      <SettingsRow
        label="Add transactions"
        onPress={jest.fn()}
        trailing={<RNText>toggle</RNText>}
        accessibilityActions={[{ name: 'toggle', label: 'Turn off' }]}
        onAccessibilityAction={jest.fn()}
      >
        <RNText>Every day at 20:00</RNText>
      </SettingsRow>,
    );
    const afterSwitch = withSwitch.getByTestId('settings-row-chevron', {
      includeHiddenElements: true,
    });

    expect(StyleSheet.flatten(afterSwitch.props.style).marginLeft).toBe(darkTheme.spacing(1));

    const labelOnly = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    const afterLabel = labelOnly.getByTestId('settings-row-chevron', {
      includeHiddenElements: true,
    });

    expect(StyleSheet.flatten(afterLabel.props.style).marginLeft).toBeUndefined();
  });

  it('centers the trailing control of a static row on its label', async () => {
    const { getByTestId } = await render(
      <SettingsRow
        label="Include saved passwords & keys"
        trailing={<RNText testID="trailing-switch">toggle</RNText>}
      >
        <RNText>Hint text below the row</RNText>
      </SettingsRow>,
    );

    const header = ancestorWithStyle(getByTestId('trailing-switch'), 'alignItems');

    expect(StyleSheet.flatten(header.props.style).alignItems).toBe('center');
  });

  // iOS reads an accessible Pressable and its children as ONE VoiceOver
  // element, so the row itself must carry the trailing control's action.
  it('runs the trailing control action from the pressable row itself', async () => {
    const onAccessibilityAction = jest.fn();
    const { getByRole } = await render(
      <SettingsRow
        label="Reminder"
        onPress={jest.fn()}
        trailing={<RNText>toggle</RNText>}
        accessibilityActions={[{ name: 'toggle', label: 'Turn off' }]}
        onAccessibilityAction={onAccessibilityAction}
      />,
    );

    const row = getByRole('button');
    expect(row.props.accessibilityActions).toEqual([{ name: 'toggle', label: 'Turn off' }]);

    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'toggle' } });
    expect(onAccessibilityAction).toHaveBeenCalledTimes(1);
  });

  // Type level, proven by `check:typecheck`: each `@ts-expect-error` below
  // fails tsc once the props type stops rejecting that shape.
  it('rejects a pressable row whose trailing control VoiceOver cannot reach', () => {
    const control = <RNText>toggle</RNText>;
    const actions = [{ name: 'toggle', label: 'Turn off' }];

    const rejected = [
      // @ts-expect-error a pressable row with a trailing control needs the control's actions
      <SettingsRow key="none" label="Row" onPress={jest.fn()} trailing={control} />,
      // @ts-expect-error the actions alone never run without a handler
      <SettingsRow
        key="actions"
        label="Row"
        onPress={jest.fn()}
        trailing={control}
        accessibilityActions={actions}
      />,
      // @ts-expect-error a handler alone offers VoiceOver no action
      <SettingsRow
        key="handler"
        label="Row"
        onPress={jest.fn()}
        trailing={control}
        onAccessibilityAction={jest.fn()}
      />,
    ];

    const accepted = [
      <SettingsRow key="neither" label="Row" />,
      <SettingsRow key="press" label="Row" onPress={jest.fn()} />,
      <SettingsRow key="trailing" label="Row" trailing={control} />,
      <SettingsRow
        key="both"
        label="Row"
        onPress={jest.fn()}
        trailing={control}
        accessibilityActions={actions}
        onAccessibilityAction={jest.fn()}
      />,
    ];

    expect(rejected).toHaveLength(3);
    expect(accepted).toHaveLength(4);
  });
});
