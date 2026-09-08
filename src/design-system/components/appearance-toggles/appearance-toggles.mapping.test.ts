import { appearanceFromToggles, togglesFromAppearance } from './appearance-toggles.mapping';

describe('appearanceFromToggles', () => {
  it('follow ON maps to system regardless of dark flag', () => {
    expect(appearanceFromToggles(true, false)).toBe('system');
    expect(appearanceFromToggles(true, true)).toBe('system');
  });

  it('follow OFF maps to dark/light by the dark flag', () => {
    expect(appearanceFromToggles(false, true)).toBe('dark');
    expect(appearanceFromToggles(false, false)).toBe('light');
  });
});

describe('togglesFromAppearance', () => {
  it('system reflects the resolved OS scheme in the dark flag, follow ON', () => {
    expect(togglesFromAppearance('system', 'dark')).toEqual({ followSystem: true, darkOn: true });
    expect(togglesFromAppearance('system', 'light')).toEqual({ followSystem: true, darkOn: false });
  });

  it('pinned light/dark ignores the resolved scheme, follow OFF', () => {
    expect(togglesFromAppearance('dark', 'light')).toEqual({ followSystem: false, darkOn: true });
    expect(togglesFromAppearance('light', 'dark')).toEqual({ followSystem: false, darkOn: false });
  });
});
