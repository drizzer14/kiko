/**
 * The module a screen suite mounts the pane stack as: the real module, with the open call handed to
 * the suite's own spy and no detail pane showing. The spy comes through a getter because the
 * factory runs while the screen is imported, before the suite's `const` is set. Wire it with
 * `jest.mock('@kiko/navigation/pane-stack', () =>
 * require('@kiko/test-support/mock-pane-stack').paneStackModule(() => mockOpenInPane))`: the
 * `require` runs inside the factory, so no import order can leave the helper undefined, and
 * `jest.mock` hoists, so the spy needs a `mock`-prefixed name. Knip does not follow a bare
 * `require`, so the wiring casts it `as typeof import('@kiko/test-support/mock-pane-stack')`,
 * which is the importer knip sees.
 */
export const paneStackModule = (openInPane: () => jest.Mock, overrides: object = {}) => ({
  ...(jest.requireActual('@kiko/navigation/pane-stack') as object),
  useOpenInPane: () => openInPane(),
  useDetailPaneRoute: () => null,
  ...overrides,
});
