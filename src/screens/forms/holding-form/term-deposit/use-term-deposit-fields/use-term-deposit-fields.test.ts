import { act, renderHook } from '@testing-library/react-native';

import { type TermDepositFieldsDraft, useTermDepositFields } from './use-term-deposit-fields';

const renderTermDepositFields = () =>
  renderHook(() => useTermDepositFields({ currency: 'UAH', scrollTo: jest.fn() }));

describe('useTermDepositFields draft', () => {
  const filled: TermDepositFieldsDraft = {
    contributions: [
      { id: 0, amount: '1 000', date: 1_700_000_000_000, saved: true },
      { id: 3, amount: '250', date: null, saved: false },
    ],
    annualRate: '12',
    term: '2',
    termUnit: 'years',
    recapitalization: true,
    compounding: 'monthly',
  };

  it('holds a blank deposit as it opens', async () => {
    const { result } = await renderTermDepositFields();

    expect(result.current.draft).toEqual({
      contributions: [{ id: 0, amount: '', date: null, saved: false }],
      annualRate: '',
      term: '',
      termUnit: 'months',
      recapitalization: false,
      compounding: 'bi-weekly',
    });
  });

  it('brings back every field, the rows with their own keys and saved marks', async () => {
    const { result } = await renderTermDepositFields();

    await act(async () => {
      result.current.restore(filled);
    });

    expect(result.current.draft).toEqual(filled);
    expect(result.current.annualRate).toBe('12');
    expect(result.current.termUnit).toBe('years');
  });

  it('adds a row under a key no restored row has', async () => {
    const { result } = await renderTermDepositFields();

    await act(async () => {
      result.current.restore(filled);
    });
    await act(async () => {
      result.current.addContribution();
    });

    expect(result.current.contributions.map((row) => row.id)).toEqual([0, 3, 4]);
  });

  it('starts keys at the first free one when the restored draft has no rows', async () => {
    const { result } = await renderTermDepositFields();

    await act(async () => {
      result.current.restore({ ...filled, contributions: [] });
    });
    await act(async () => {
      result.current.addContribution();
    });

    expect(result.current.contributions.map((row) => row.id)).toEqual([0]);
  });

  it('keeps one restore across renders, so the screen effect that depends on it runs once', async () => {
    const { result } = await renderTermDepositFields();
    const first = result.current.restore;

    await act(async () => {
      result.current.setAnnualRate('5');
    });

    expect(result.current.restore).toBe(first);
  });
});
