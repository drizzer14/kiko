import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../unistyles';

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

  it('marks the selected segment via accessibilityState and announces its N/M position', async () => {
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

    expect(single.props.accessibilityState).toEqual({ selected: true });
    expect(debitCredit.props.accessibilityState).toEqual({ selected: false });
    expect(single.props.accessibilityRole).toBe('tab');
    expect(single.props.accessibilityValue).toEqual({ text: '1 / 2' });
    expect(debitCredit.props.accessibilityValue).toEqual({ text: '2 / 2' });
  });

  // F3 fix round 1, M4: the group itself carries an accessibilityLabel — a
  // required prop, so VoiceOver never reads a segment with no group context.
  it('labels the group with the given accessibilityLabel', async () => {
    const { getByLabelText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
      />,
    );

    expect(getByLabelText('Amount mode').props.accessibilityRole).toBe('tablist');
  });

  // F3 fix round 1, I3: the selected segment's fill against the track meets
  // the WCAG 1.4.11 3:1 non-text contrast floor.
  it('gives the selected segment >= 3:1 contrast against the track', () => {
    const ratio = wcagContrastRatio(darkTheme.colors.segmentSelected, darkTheme.colors.surface);

    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  // F3 fix round 1, M1: the visible track is ~32pt, matching native
  // UISegmentedControl, not the 44pt HIG floor itself — the floor is
  // restored via hitSlop instead (proven structurally here; the actual
  // hitSlop value is asserted below).
  it('restores the 44pt HIG touch target via hitSlop on a shorter visible track', async () => {
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        accessibilityLabel="Amount mode"
        testID="mode-segmented"
      />,
    );

    expect(getByTestId('mode-segmented-option-single').props.hitSlop).toEqual({
      top: 6,
      bottom: 6,
    });
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
});
