import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import { i18n } from '@kiko/i18n/init';

import { darkTheme } from '../../theme';
import { wcagContrastRatio } from '../../entity-tint';

import SegmentedControl from '.';

const options = ['single', 'debitCredit'] as const;

// An `rgba(r,g,b,a)` token composited over an opaque `#RRGGBB` backdrop, as the
// opaque hex a contrast check needs.
const compositeOver = (rgba: string, backdropHex: string): string => {
  const [red, green, blue, alpha] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  const backdrop = [1, 3, 5].map((offset) => parseInt(backdropHex.slice(offset, offset + 2), 16));

  return `#${[red, green, blue]
    .map((channel, index) => Math.round(channel * alpha + backdrop[index] * (1 - alpha)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
};

describe('SegmentedControl', () => {
  it('reports the pressed option through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={onSelect}
        accessibilityLabel="Amount mode"
      />,
    );

    await fireEvent.press(getByText('debitCredit'));

    expect(onSelect).toHaveBeenCalledWith('debitCredit');
  });

  it('humanizes segment text through the labels map while still reporting the raw value', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={onSelect}
        labels={{ single: 'Single', debitCredit: 'Debit / Credit' }}
        accessibilityLabel="Amount mode"
      />,
    );

    await fireEvent.press(getByText('Debit / Credit'));

    expect(onSelect).toHaveBeenCalledWith('debitCredit');
  });

  // Each segment keeps the "button" trait (RN 0.87 maps
  // "tab"/"tablist" to no trait on iOS — see the component's own doc
  // comment), carries its own accessibilityLabel and selected state, and
  // folds the group name + a TRANSLATED "N of M" position into its hint.
  it('marks the selected segment via accessibilityState, keeps the button role, and folds the group/position into the hint', async () => {
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
        testID="mode-segmented"
      />,
    );

    const single = getByTestId('mode-segmented-option-single');
    const debitCredit = getByTestId('mode-segmented-option-debitCredit');

    expect(single.props.accessibilityRole).toBe('button');
    expect(single.props.accessibilityState).toEqual({ selected: true });
    expect(debitCredit.props.accessibilityState).toEqual({ selected: false });
    expect(single.props.accessibilityLabel).toBe('single');
    expect(single.props.accessibilityHint).toBe(
      `Amount mode, ${i18n.t('common.segmentPosition', { index: 1, count: 2 })}`,
    );
    expect(debitCredit.props.accessibilityHint).toBe(
      `Amount mode, ${i18n.t('common.segmentPosition', { index: 2, count: 2 })}`,
    );
  });

  // The native iOS segmented look: a faint neutral track and a lighter raised
  // thumb (the selected label stays textPrimary, semibold).
  it('paints a faint neutral track under a lighter thumb', async () => {
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
        testID="mode-segmented"
      />,
    );

    expect(
      StyleSheet.flatten(getByTestId('mode-segmented-track').props.style).backgroundColor,
    ).toBe(darkTheme.colors.neutralSubtle);
    expect(
      StyleSheet.flatten(getByTestId('mode-segmented-selected').props.style).backgroundColor,
    ).toBe(darkTheme.colors.segmentSelected);
  });

  // The translucent track composites over whatever sits behind the control:
  // the true-black screen, or a card/sheet at `surface`. The thumb must meet
  // the WCAG 1.4.11 3:1 non-text contrast floor against the track on both,
  // and the selected white label must stay legible (4.5:1) on the thumb.
  it('gives the thumb >= 3:1 contrast against the track on black and on surface', () => {
    for (const backdrop of [darkTheme.colors.background, darkTheme.colors.surface]) {
      const track = compositeOver(darkTheme.colors.neutralSubtle, backdrop);

      expect(wcagContrastRatio(darkTheme.colors.segmentSelected, track)).toBeGreaterThanOrEqual(3);
    }

    expect(
      wcagContrastRatio(darkTheme.colors.textPrimary, darkTheme.colors.segmentSelected),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Each segment is a REAL
  // layout box at least 44pt tall (no `hitSlop`; `minHeight`, so Dynamic
  // Type can grow it). The visible 32pt track and the 24pt selected pill
  // (a 4pt ring of track around it) are decorative insets. The container's
  // negative vertical margin keeps the control's layout footprint at the
  // 32pt track. Jest cannot hit-test; the RN 0.87 Fabric reasoning that
  // the overflow band stays touchable lives in the styles file header.
  it('gives each segment a real 44pt minimum height, a 32pt track, a 24pt pill, and a 32pt footprint', async () => {
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
        testID="mode-segmented"
      />,
    );

    const segment = getByTestId('mode-segmented-option-single');
    const segmentStyle = StyleSheet.flatten(segment.props.style);
    expect(segment.props.hitSlop).toBeUndefined();
    expect(segmentStyle.minHeight).toBe(44);
    expect(segmentStyle.height).toBeUndefined();

    const trackFill = StyleSheet.flatten(getByTestId('mode-segmented-track').props.style);
    expect(trackFill.top).toBe(trackFill.bottom);
    expect(44 - trackFill.top - trackFill.bottom).toBe(32);

    const container = StyleSheet.flatten(getByTestId('mode-segmented').props.style);
    expect(44 + 2 * container.marginVertical).toBe(32);

    const pill = StyleSheet.flatten(getByTestId('mode-segmented-selected').props.style);
    expect(pill.top).toBe(pill.bottom);
    expect(44 - pill.top - pill.bottom).toBe(24);
    expect(pill.top - trackFill.top).toBe(4);
  });

  // A long label stays on one line (shrinking to fit
  // rather than wrapping), centered in its segment.
  it('keeps a long label on one line, centered', async () => {
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        labels={{ single: 'One amount column', debitCredit: 'Debit and credit columns' }}
        accessibilityLabel="Amount mode"
      />,
    );

    const label = getByText('Debit and credit columns');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(StyleSheet.flatten(label.props.style).textAlign).toBe('center');
  });

  // The selected label's style composes ON TOP
  // of the base `label` style (never a duplicate `textAlign`).
  it('keeps the selected label centered too, alongside its semibold weight', async () => {
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
      />,
    );

    const flattened = StyleSheet.flatten(getByText('single').props.style);
    expect(flattened.textAlign).toBe('center');
    expect(flattened.fontWeight).toBe('600');
  });
});
