import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';

import { i18n } from '../../../i18n';
import { darkTheme } from '../../theme';
import { wcagContrastRatio } from '../../entity-tint';

import SegmentedControl from '.';

const options = ['single', 'debitCredit'] as const;

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

  // F3 fix round 2, M4: each segment keeps the "button" trait (RN 0.87 maps
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

  // F3 fix round 1, I3: the selected segment's fill against the track meets
  // the WCAG 1.4.11 3:1 non-text contrast floor.
  it('gives the selected segment >= 3:1 contrast against the track', () => {
    const ratio = wcagContrastRatio(darkTheme.colors.segmentSelected, darkTheme.colors.surface);

    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  // F3 fix round 3, N6 + fix round 4, N10/N11: each segment is a REAL
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

  // F3 fix round 1, M2: a long label stays on one line (shrinking to fit
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

  // F3 fix round 2, N5 ponytail: the selected label's style composes ON TOP
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
