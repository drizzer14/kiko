import '@kiko/design-system/unistyles';

import { createPaneStackNavigator, type PaneConfig, useIsScreenVisible, useOpenInPane } from '.';

describe('the pane stack feature', () => {
  it('exports the navigator factory and the two hooks a screen in a pane uses', () => {
    expect(typeof createPaneStackNavigator).toBe('function');
    expect(typeof useOpenInPane).toBe('function');
    expect(typeof useIsScreenVisible).toBe('function');
  });

  it('takes its per-tab config as a root pane and an optional default for each pane', () => {
    const config: PaneConfig = {
      rootPane: 'companion',
      primaryDefault: { name: 'Categories', isDefault: true },
    };

    expect(config.primaryDefault?.name).toBe('Categories');
  });
});
