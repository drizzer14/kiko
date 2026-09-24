import { fireEvent, render } from '@testing-library/react-native';

import '../../../../design-system/unistyles';
import '../../../../i18n';

import LoanSection from './loan-section.component';

const baseProps = {
  kind: 'mortgage' as const,
  onSelectKind: jest.fn(),
  principal: '',
  onChangePrincipal: jest.fn(),
  currencySuffix: '₴',
  startDate: null,
  onChangeStartDate: jest.fn(),
  schedule: 'annuity' as const,
  onSelectSchedule: jest.fn(),
  annualRatePct: '',
  onChangeAnnualRatePct: jest.fn(),
  termMonths: '',
  onChangeTermMonths: jest.fn(),
};

describe('LoanSection', () => {
  it('renders every loan kind as a chip, under the Loan Kind label', async () => {
    const { getByText } = await render(<LoanSection {...baseProps} />);

    expect(getByText('Loan kind')).toBeTruthy();
    expect(getByText('Mortgage')).toBeTruthy();
    expect(getByText('Car loan')).toBeTruthy();
    expect(getByText('Consumer loan')).toBeTruthy();
    expect(getByText('From a person')).toBeTruthy();
  });

  it('reports the tapped kind', async () => {
    const onSelectKind = jest.fn();
    const { getByText } = await render(<LoanSection {...baseProps} onSelectKind={onSelectKind} />);

    await fireEvent.press(getByText('Car loan'));

    expect(onSelectKind).toHaveBeenCalledWith('car_loan');
  });

  it('reports the entered principal', async () => {
    const onChangePrincipal = jest.fn();
    const { getByLabelText } = await render(
      <LoanSection {...baseProps} onChangePrincipal={onChangePrincipal} />,
    );

    await fireEvent.changeText(getByLabelText('Principal'), '500000');

    expect(onChangePrincipal).toHaveBeenCalledWith('500000');
  });

  it('renders principalError directly after the field', async () => {
    const { getByText } = await render(
      <LoanSection {...baseProps} principalError="Enter a principal greater than 0." />,
    );

    expect(getByText('Enter a principal greater than 0.')).toBeTruthy();
  });

  it('reports a picked start date', async () => {
    const onChangeStartDate = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <LoanSection {...baseProps} onChangeStartDate={onChangeStartDate} />,
    );

    await fireEvent.press(getByLabelText('Start date'));
    await fireEvent(getByTestId('Start date calendar'), 'dayPress', {
      year: 2026,
      month: 1,
      day: 15,
      dateString: '2026-01-15',
      timestamp: 0,
    });

    expect(onChangeStartDate).toHaveBeenCalledWith(new Date(2026, 0, 15).getTime());
  });

  it('renders startDateError directly after the field', async () => {
    const { getByText } = await render(
      <LoanSection {...baseProps} startDateError="Pick a start date." />,
    );

    expect(getByText('Pick a start date.')).toBeTruthy();
  });

  it('renders the schedule choices under the Schedule label and control', async () => {
    const { getByText } = await render(<LoanSection {...baseProps} />);

    expect(getByText('Schedule')).toBeTruthy();
    expect(getByText('Annuity')).toBeTruthy();
    expect(getByText('Differentiated')).toBeTruthy();
    expect(getByText('No schedule')).toBeTruthy();
  });

  it('reports the tapped schedule', async () => {
    const onSelectSchedule = jest.fn();
    const { getByText } = await render(
      <LoanSection {...baseProps} onSelectSchedule={onSelectSchedule} />,
    );

    await fireEvent.press(getByText('No schedule'));

    expect(onSelectSchedule).toHaveBeenCalledWith('none');
  });

  it('shows the rate and term fields for an annuity/differentiated schedule', async () => {
    const { getByLabelText } = await render(
      <LoanSection {...baseProps} schedule="differentiated" />,
    );

    expect(getByLabelText('Annual rate %')).toBeTruthy();
    expect(getByLabelText('Term (months)')).toBeTruthy();
  });

  it('hides the rate and term fields for a "none" schedule', async () => {
    const { queryByLabelText } = await render(<LoanSection {...baseProps} schedule="none" />);

    expect(queryByLabelText('Annual rate %')).toBeNull();
    expect(queryByLabelText('Term (months)')).toBeNull();
  });

  it('reports the entered rate and term', async () => {
    const onChangeAnnualRatePct = jest.fn();
    const onChangeTermMonths = jest.fn();
    const { getByLabelText } = await render(
      <LoanSection
        {...baseProps}
        onChangeAnnualRatePct={onChangeAnnualRatePct}
        onChangeTermMonths={onChangeTermMonths}
      />,
    );

    await fireEvent.changeText(getByLabelText('Annual rate %'), '12');
    await fireEvent.changeText(getByLabelText('Term (months)'), '24');

    expect(onChangeAnnualRatePct).toHaveBeenCalledWith('12');
    expect(onChangeTermMonths).toHaveBeenCalledWith('24');
  });

  it('renders annualRatePctError and termMonthsError directly after their fields', async () => {
    const { getByText } = await render(
      <LoanSection
        {...baseProps}
        annualRatePctError="Enter a rate of 0 or higher."
        termMonthsError="Enter a whole number of months greater than 0."
      />,
    );

    expect(getByText('Enter a rate of 0 or higher.')).toBeTruthy();
    expect(getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
  });
});
