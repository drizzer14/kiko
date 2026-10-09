import '@kiko/design-system/unistyles';

import { createPaneStackNavigator, useIsScreenVisible, useOpenInPane } from '.';

describe('the pane stack feature', () => {
  it('exports the navigator factory and the two hooks a screen in a pane uses', () => {
    expect(typeof createPaneStackNavigator).toBe('function');
    expect(typeof useOpenInPane).toBe('function');
    expect(typeof useIsScreenVisible).toBe('function');
  });
});
