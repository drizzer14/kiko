import { tabBarPlacementOf } from './tab-bar-placement';

describe('tabBarPlacementOf', () => {
  describe('native edge top or bottom, the bar reported by its real frame', () => {
    it.each([
      [
        'puts the bar at the top when the native edge is top (Pro 13-inch full portrait, 64 of 1376 pt)',
        'top',
        64,
        1376,
        'top',
      ],
      ['at the top of the 683x909 Stage Manager half', 'top', 72, 909, 'top'],
      ['at the bottom of the compact 375x563 window, 72 of 563 pt', 'bottom', 72, 563, 'bottom'],
      ['at the bottom of compact Slide Over, 77 of 968 pt', 'bottom', 77, 968, 'bottom'],
      [
        'keeps the Duo inner portrait at the bottom: native edge bottom on a regular 669x951 window',
        'bottom',
        83,
        951,
        'bottom',
      ],
      ['treats an implausible 678 of 678 pt bottom bar as a side bar', 'bottom', 678, 678, 'side'],
    ] as const)('%s', (_title, tabBarEdge, tabBarHeight, windowHeight, expected) => {
      expect(tabBarPlacementOf(tabBarEdge, 'none', tabBarHeight, windowHeight)).toBe(expected);
    });

    it.each(['leading', 'trailing'] as const)(
      'keeps a side bar when the native edge says bottom but the system reports a vertical bar (Duo inner landscape, %s)',
      (verticalBarEdge) => {
        expect(tabBarPlacementOf('bottom', verticalBarEdge, 83, 669)).toBe('side');
      },
    );
  });

  describe.each(['leading', 'trailing'] as const)('native edge %s', (tabBarEdge) => {
    it('is a side bar, whatever the reported tab bar height', () => {
      expect(tabBarPlacementOf(tabBarEdge, 'none', 678, 678)).toBe('side');
      expect(tabBarPlacementOf(tabBarEdge, 'trailing', 80, 844)).toBe('side');
      expect(tabBarPlacementOf(tabBarEdge, 'none', 0, 844)).toBe('side');
    });
  });

  describe('native edge none (unknown): today the vertical bar edge and the plausibility guard', () => {
    it('treats an implausible 678 of 678 pt bar as a side bar', () => {
      expect(tabBarPlacementOf('none', 'none', 678, 678)).toBe('side');
    });

    it('keeps a bar at exactly half the window, the plausible limit', () => {
      expect(tabBarPlacementOf('none', 'none', 300, 600)).toBe('bottom');
    });

    it('trusts the bar height while the window height is not known yet', () => {
      expect(tabBarPlacementOf('none', 'none', 80, 0)).toBe('bottom');
    });

    it.each(['leading', 'trailing'] as const)(
      'a vertical bar edge with an unknown tab bar edge is a side bar (%s)',
      (verticalBarEdge) => {
        expect(tabBarPlacementOf('none', verticalBarEdge, 80, 844)).toBe('side');
      },
    );

    it('an unknown edge on an iPhone stays bottom', () => {
      expect(tabBarPlacementOf('none', 'none', 83, 844)).toBe('bottom');
    });
  });
});
