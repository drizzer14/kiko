/**
 * The module a screen suite mounts the pane stack as: the real module, with the open call handed to
 * the suite's own spy and no detail pane showing. The spy comes through a getter because the
 * factory runs while the screen is imported, before the suite's `const` is set. Wire it with
 * `import { paneStackModule as mockPaneStackModule } from '@kiko/test-support/mock-pane-stack'`
 * and `jest.mock('@kiko/navigation/pane-stack', () => mockPaneStackModule(() =>
 * mockOpenInPane))`: `jest.mock` hoists, so only a `mock`-prefixed name works there.
 */
export const paneStackModule = (openInPane: () => jest.Mock, overrides: object = {}) => ({
  ...(jest.requireActual('@kiko/navigation/pane-stack') as object),
  useOpenInPane: () => openInPane(),
  useDetailPaneRoute: () => null,
  ...overrides,
});
