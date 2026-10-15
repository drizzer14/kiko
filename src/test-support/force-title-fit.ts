import type { ReactElement } from 'react';

type UseTitleFitMock = jest.Mock<{ fits: boolean; measurer: ReactElement | null }, [string]>;

// Jest lays no text out, so `jest/setup.js` mocks `useTitleFit` to "fits"; a test of the wrapping
// heading path sets the answer here instead. Read through `requireMock` so the helper does not
// import another feature's inner file.
const useTitleFitMock = (): UseTitleFitMock =>
  (
    jest.requireMock('@kiko/navigation/fitting-large-title/use-title-fit') as {
      useTitleFit: UseTitleFitMock;
    }
  ).useTitleFit;

/**
 * Makes every title measure as fitting (`true`) or not fitting (`false`) from now on. `measurer`
 * stands in for the invisible measuring element the real hook returns.
 */
export const forceTitleFit = (fits: boolean, measurer: ReactElement | null = null): void => {
  useTitleFitMock().mockReturnValue({ fits, measurer });
};

/** Puts the global default back: every title fits. Call it from an `afterEach`. */
export const restoreTitleFit = (): void => forceTitleFit(true);
