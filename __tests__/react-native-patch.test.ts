import { join } from 'node:path';
import { Animated } from 'react-native';
import { createElement, useContext } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { act, render, renderHook } from '@testing-library/react-native';

const ROOT = join(__dirname, '..');
const SCROLL_VIEW_FILE =
  'node_modules/react-native/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm';
const PATCH_FILE = 'patches/react-native+0.87.1.patch';

// The patch changes React Native's native keyboard handler so a scroll view's offset moves only
// for a field inside it (without it, one pane's keyboard blanks the other pane). It is written for
// exactly one React Native version, so a version bump must fail here and force a re-check of the
// patch (see docs/harness/documented-exceptions.md, "patch-package patches").
describe('the React Native ScrollView keyboard patch', () => {
  it('ships a patch that touches only the ScrollView component view', () => {
    const patch = readFileSync(join(ROOT, PATCH_FILE), 'utf8');
    const touchedFiles = patch
      .split('\n')
      .filter((line) => line.startsWith('diff --git '))
      .map((line) => line.split(' b/')[1]);

    expect(touchedFiles).toEqual([SCROLL_VIEW_FILE]);
  });

  it('pins react-native to exactly the version the patch was written for', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.dependencies['react-native']).toBe('0.87.1');
  });

  it('is applied to the installed ScrollView component view', () => {
    const source = readFileSync(join(ROOT, SCROLL_VIEW_FILE), 'utf8');

    expect(source).toContain('A field outside this scroll view must not move its offset');
    expect(source).not.toContain('_firstResponderViewOutsideScrollView.inputAccessoryView');
  });
});

const SCREENS_PATCH_FILE = 'patches/react-native-screens+4.30.1.patch';
const SCREENS_DIRECTORY = 'node_modules/react-native-screens';

// The patch gives a pane's native stack the content's fixed side margin, so its large title lines
// up with the content where UIKit would inset it by the pane's distance to the window's edge. It
// changes behaviour only for a stack whose `fixedContentMargin` prop is above 0 (see
// docs/harness/documented-exceptions.md, "patch-package patches").
describe('the react-native-screens fixed content margin patch', () => {
  const read = (path: string) => readFileSync(join(ROOT, SCREENS_DIRECTORY, path), 'utf8');

  it('touches only react-native-screens files, the native stack among them', () => {
    const patch = readFileSync(join(ROOT, SCREENS_PATCH_FILE), 'utf8');
    const touchedFiles = patch
      .split('\n')
      .filter((line) => line.startsWith('diff --git '))
      .map((line) => line.split(' b/')[1]);

    expect(touchedFiles.filter((file) => !file.startsWith(`${SCREENS_DIRECTORY}/`))).toEqual([]);
    expect(touchedFiles).toContain(`${SCREENS_DIRECTORY}/ios/RNSScreenStack.mm`);
  });

  it('pins react-native-screens to exactly the version the patch was written for', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.dependencies['react-native-screens']).toBe('4.30.1');
  });

  it('is applied to the native stack, which touches the margins only while the prop is above 0', () => {
    const source = read('ios/RNSScreenStack.mm');

    expect(source).toContain('viewRespectsSystemMinimumLayoutMargins = NO');
    expect(source).toContain('forced.leading = margin;');
    expect(source).toContain('forced.trailing = margin;');
    expect(source).toContain('RNSSetHorizontalLayoutMargins(self.view, _fixedContentMargin);');
    expect(source).toContain(
      'RNSSetHorizontalLayoutMargins(self.navigationBar, _fixedContentMargin);',
    );
    expect(source).toContain('if (_fixedContentMargin <= 0) {');
    expect(source).toContain(
      'navigationController.fixedContentMargin = newScreenProps.fixedContentMargin;',
    );
    expect(read('ios/RNSScreenStack.h')).toContain(
      '@property (nonatomic) CGFloat fixedContentMargin;',
    );
  });

  // The getter of a controller's root view returns the stored margin plus the safe area inset, so
  // writing it back would add the inset to the top and bottom margin at every layout pass.
  it('writes back stored margins, not the getter’s margins plus the safe area inset', () => {
    const source = read('ios/RNSScreenStack.mm');
    const gettersRead = source.match(/=\s*[\w.]*\.directionalLayoutMargins;/g);

    expect(source).toContain('if (view.insetsLayoutMarginsFromSafeArea) {');
    expect(source).toContain('margins.top -= safeArea.top;');
    expect(source).toContain('margins.bottom -= safeArea.bottom;');
    expect(source).toContain('UIEdgeInsets safeArea = view.safeAreaInsets;');
    expect(source).toContain(
      'view.effectiveUserInterfaceLayoutDirection == UIUserInterfaceLayoutDirectionRightToLeft;',
    );
    expect(source).toContain('margins.leading -= isRightToLeft ? safeArea.right : safeArea.left;');
    expect(source).toContain('margins.trailing -= isRightToLeft ? safeArea.left : safeArea.right;');
    expect(gettersRead).toEqual(['= view.directionalLayoutMargins;']);
    expect(source).toContain(
      '_viewMarginsBeforeFixedContentMargin = RNSStoredDirectionalLayoutMargins(self.view);',
    );
    expect(source).toContain(
      '_barMarginsBeforeFixedContentMargin = RNSStoredDirectionalLayoutMargins(self.navigationBar);',
    );
  });

  it('skips the write when the leading and trailing margins already hold', () => {
    const source = read('ios/RNSScreenStack.mm');

    expect(source).toContain(
      'if (!NSDirectionalEdgeInsetsEqualToDirectionalEdgeInsets(stored, forced)) {',
    );
  });

  const patchedLines = () =>
    readFileSync(join(ROOT, SCREENS_PATCH_FILE), 'utf8')
      .split('\n')
      .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' '))
      .map((line) => line.slice(1))
      .join('\n');
  const sources = [
    ['the patch file', patchedLines],
    ['the installed file', () => read('ios/RNSScreenStack.mm')],
  ] as const;
  const withoutComments = (code: string) =>
    code
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join(' ')
      .replace(/\s+/g, ' ');
  // A method's code up to the next method, comments dropped and whitespace collapsed.
  const methodCode = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    const end = source.indexOf('\n- (', start + 1);

    return withoutComments(source.slice(start, end));
  };
  // A C function's code up to its closing brace at column 0, in the same form.
  const functionCode = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    const end = source.indexOf('\n}\n', start);

    return start === -1 ? '' : withoutComments(source.slice(start, end + 2));
  };

  // On iOS 27.2 the leading split pane's large title is laid out in a separate row under an empty
  // bar row. Setting the item's mode to Inline puts it in the bar row like the other pane. The
  // lever acts on the measured layout, so these pins hold the shipped text, not UIKit's behavior.
  describe('iOS 27.2 stacked pane title', () => {
    const LEVER = 'static void RNSInlineStackedPaneLargeTitle(';

    it.each(sources)(
      'runs after the safe top correction at each layout pass, in %s',
      (_name, load) => {
        const source = load();
        const layoutPass = methodCode(source, '- (void)viewDidLayoutSubviews');

        const syncCall = layoutPass.indexOf('[self syncParentSafeAreaTopInset];');

        expect(syncCall).toBeGreaterThan(-1);
        expect(layoutPass.indexOf('RNSInlineStackedPaneLargeTitle(self);')).toBeGreaterThan(
          syncCall,
        );
        expect(source.match(/RNSInlineStackedPaneLargeTitle\(self\)/g)).toHaveLength(1);
      },
    );

    it.each(sources)(
      'acts only on iOS 27.2, a pane narrower than the window and a stacked title, in %s',
      (_name, load) => {
        const lever = functionCode(load(), LEVER);

        expect(lever).toContain('if (@available(iOS 27.2, *)) {');
        expect(lever).toMatch(/window == nil \|\| [\w.]*size\.width >= [\w.]*width - 0\.5/);
        expect(lever).toMatch(/RNSFindLargeTitleView\(\w+, 0\)/);
        expect(lever).toMatch(
          /largeTitleFrame\.size\.height <= 0\.5 \|\| largeTitleFrame\.origin\.y < 0\.5/,
        );
        expect(lever).toContain('convertRect:largeTitleView.frame toView:');
      },
    );

    it.each(sources)('finds the title view by its class name, in %s', (_name, load) => {
      const finder = functionCode(load(), 'static UIView *RNSFindLargeTitleView(');

      expect(finder).toContain('strstr(object_getClassName(subview), "LargeTitle") != NULL');
    });

    it.each(sources)(
      'writes Inline only while the mode is Always, then asks the bar to lay out, in %s',
      (_name, load) => {
        const lever = functionCode(load(), LEVER);
        const always = lever.indexOf(
          'largeTitleDisplayMode != UINavigationItemLargeTitleDisplayModeAlways',
        );
        const inline = lever.indexOf(
          'largeTitleDisplayMode = UINavigationItemLargeTitleDisplayModeInline;',
        );

        expect(always).toBeGreaterThan(-1);
        expect(inline).toBeGreaterThan(always);
        expect(lever.match(/UINavigationItemLargeTitleDisplayMode\w+/g)).toEqual([
          'UINavigationItemLargeTitleDisplayModeAlways',
          'UINavigationItemLargeTitleDisplayModeInline',
        ]);
        expect(lever.indexOf('[bar setNeedsLayout];')).toBeGreaterThan(inline);
        expect(lever).toContain('#if !TARGET_OS_TV');
      },
    );

    it('ships no diagnostics: no log, no F2 text and no timer in the patch file', () => {
      const patch = readFileSync(join(ROOT, SCREENS_PATCH_FILE), 'utf8');

      expect(patch).not.toContain('NSLog');
      expect(patch).not.toContain('F2');
      expect(patch).not.toContain('dispatch_after');
    });
  });

  // The Tables column header follows the minimized iOS 27 navigation bar through the header height
  // that react-native-screens reports: upstream notifies it from the bar's own layout pass and
  // reads it from the bar's visible subviews, so these pins fail if a later release drops either.
  describe('upstream header height that follows the minimized bar', () => {
    it('notifies the screen of a new header height from the navigation bar layout pass', () => {
      const layoutPass = methodCode(
        read('ios/RNSScreenStack.mm'),
        '- (void)navigationBarDidLayoutSubviews:',
      );

      expect(layoutPass).toContain('notifyHeaderHeightChangeToScreen:');
    });

    it('measures the header height from the bar subviews that are still visible', () => {
      expect(read('ios/RNSScreen.mm')).toContain(
        '- (CGFloat)calculateMinimizationAwareHeaderHeightInNavigationController:',
      );
    });

    it('reports that minimization-aware height as the screen’s header height', () => {
      const headerHeight = methodCode(
        read('ios/RNSScreen.mm'),
        '- (CGFloat)calculateHeaderHeightIsModal:',
      );

      expect(headerHeight).toContain(
        '[self calculateMinimizationAwareHeaderHeightInNavigationController:navctr]',
      );
    });
  });

  // The header height event also carries how far the iOS 27 bar has minimized, read from its
  // background's alpha on the same layout pass, so the Tables status band follows the bar with no
  // JS in between. These pins hold the shipped text: that the iOS 27 bar really behaves so is shown
  // on a device, not by Jest.
  describe('minimized fraction of the bar', () => {
    const fractionMethod = (source: string) =>
      methodCode(source, '- (CGFloat)calculateMinimizedFractionIsModal:');

    it('adds the field to the codegen spec and its typed copy, after the header height', () => {
      expect(read('src/fabric/ScreenNativeComponent.ts')).toMatch(
        /headerHeight: CT\.Double;\s*(?:\/\/[^\n]*\s*)*minimizedFraction: CT\.Double;/,
      );
      expect(read('lib/typescript/fabric/ScreenNativeComponent.d.ts')).toMatch(
        /headerHeight: CT\.Double;\s*minimizedFraction: CT\.Double;/,
      );
    });

    it('leaves the modal screen spec as it is, and no native file uses its event emitter', () => {
      expect(read('src/fabric/ModalScreenNativeComponent.ts')).not.toContain('minimizedFraction');
      expect(read('ios/RNSScreen.mm')).not.toContain('RNSModalScreenEventEmitter');
      expect(read('ios/RNSScreenStack.mm')).not.toContain('RNSModalScreenEventEmitter');
    });

    it('types the field as an optional number, for iOS only', () => {
      expect(read('src/types.tsx')).toMatch(
        /HeaderHeightChangeEventType = \{\s*headerHeight: number;\s*(?:\/\/[^\n]*\s*)*minimizedFraction\?: number;\s*\};/,
      );
      expect(read('lib/typescript/types.d.ts')).toMatch(
        /HeaderHeightChangeEventType = \{\s*headerHeight: number;\s*minimizedFraction\?: number;\s*\};/,
      );
    });

    it('hands the fraction to the Fabric emit and to the event the native driver reads', () => {
      const notify = methodCode(read('ios/RNSScreen.mm'), '- (void)notifyHeaderHeightChange:');

      expect(read('ios/RNSScreen.h')).toContain(
        '- (void)notifyHeaderHeightChange:(double)height minimizedFraction:(double)minimizedFraction;',
      );
      expect(notify).toContain(
        'OnHeaderHeightChange{ .headerHeight = headerHeight, .minimizedFraction = minimizedFraction}',
      );
      expect(notify).toContain('headerHeight:headerHeight minimizedFraction:minimizedFraction];');
    });

    it('puts the fraction in the body of the event, and leaves its coalescing key alone', () => {
      const header = read('ios/events/RNSHeaderHeightChangeEvent.h');
      const source = read('ios/events/RNSHeaderHeightChangeEvent.mm');

      expect(header).toContain('headerHeight:(double)headerHeight');
      expect(header).toContain('minimizedFraction:(double)minimizedFraction;');
      expect(source).toContain('_minimizedFraction = minimizedFraction;');
      expect(source).toContain('@"minimizedFraction" : @(_minimizedFraction),');
      expect(source).toContain('return _headerHeight;');
    });

    it('sends the fraction from the same pass that sends the header height', () => {
      const notified = methodCode(
        read('ios/RNSScreen.mm'),
        '- (void)calculateAndNotifyHeaderHeightChangeIsModal:',
      );

      expect(notified).toContain('[self calculateMinimizedFractionIsModal:isModal]');
      expect(notified).toContain(
        '[self.screenView notifyHeaderHeightChange:totalHeight minimizedFraction:minimizedFraction];',
      );
    });

    it('is 0 without a navigation controller or with the bar hidden, as the height is', () => {
      const fraction = fractionMethod(read('ios/RNSScreen.mm'));

      expect(fraction).toContain(
        'UINavigationController *navctr = [self getVisibleNavigationControllerIsModal:isModal];',
      );
      expect(fraction).toContain(
        'if (navctr == nil || navctr.isNavigationBarHidden) { return 0; }',
      );
    });

    it('reads the bar only on iOS 27 and returns the literal 0 outside that block', () => {
      const source = read('ios/RNSScreen.mm');
      const fraction = fractionMethod(source);
      const guarded = fraction.indexOf('@available(iOS 27.0, *)');
      const closed = fraction.indexOf('#endif');

      expect(fraction).toContain('#if RNS_IPHONE_OS_VERSION_AVAILABLE(27_0) && !TARGET_OS_TV');
      expect(guarded).toBeGreaterThan(-1);
      expect(
        fraction.indexOf('[self calculateMinimizedFractionInNavigationController:navctr]'),
      ).toBeGreaterThan(guarded);
      expect(fraction.slice(closed).trim()).toBe(
        '#endif // RNS_IPHONE_OS_VERSION_AVAILABLE(27_0) && !TARGET_OS_TV return 0; }',
      );
    });

    it('walks the bar inside the same iOS 27 block as the minimization-aware height', () => {
      const source = read('ios/RNSScreen.mm');
      const walker = source.indexOf('- (CGFloat)calculateMinimizedFractionInNavigationController:');
      const block = source.lastIndexOf('#if RNS_IPHONE_OS_VERSION_AVAILABLE(27_0)', walker);
      const closed = source.indexOf('#endif // RNS_IPHONE_OS_VERSION_AVAILABLE(27_0)', walker);
      const heightWalker = source.indexOf(
        '- (CGFloat)calculateMinimizationAwareHeaderHeightInNavigationController:',
      );

      expect(heightWalker).toBeGreaterThan(block);
      expect(heightWalker).toBeLessThan(walker);
      expect(closed).toBeLessThan(source.indexOf('- (CGFloat)calculateMinimizedFractionIsModal:'));
      expect(
        methodCode(source, '- (CGFloat)calculateMinimizedFractionInNavigationController:'),
      ).toContain('API_AVAILABLE(ios(27.0))');
    });

    it('is the opposite of the alpha of the one visible bar background, clamped', () => {
      const walker = methodCode(
        read('ios/RNSScreen.mm'),
        '- (CGFloat)calculateMinimizedFractionInNavigationController:',
      );

      expect(walker).toContain('for (UIView *subview in navctr.navigationBar.subviews) {');
      expect(walker).toContain(
        '[NSStringFromClass(subview.class) isEqualToString:@"_UIBarBackground"]',
      );
      expect(walker).toContain('subview.isHidden');
      expect(walker).toContain('if (background != nil) { return 0; }');
      expect(walker).toContain('if (background == nil) { return 0; }');
      expect(walker).toContain('return 1 - MIN(1, MAX(0, background.alpha));');
    });

    it('touches the event files besides the screen files', () => {
      const patch = readFileSync(join(ROOT, SCREENS_PATCH_FILE), 'utf8');

      expect(patch).toContain(`${SCREENS_DIRECTORY}/ios/events/RNSHeaderHeightChangeEvent.mm`);
      expect(patch).toContain(`${SCREENS_DIRECTORY}/ios/RNSScreen.mm`);
    });
  });

  // The minimized fraction reaches the JS side as one native-driven value: the screen attaches it
  // to its own header height event beside the native stack's mapping and hands it down like the
  // transition progress. The text pins hold the three copies Metro, Jest and tsc load; that the
  // native driver really receives the second mapping is shown on a device, not by Jest.
  describe('the bar minimized fraction context', () => {
    const SCREEN_COPIES = ['src/components/Screen.tsx', 'lib/commonjs/components/Screen.js'];

    it('defines the context with no value outside a screen, in every copy', () => {
      expect(read('src/contexts.tsx')).toMatch(
        /HeaderMinimizationContext = React\.createContext<\s*Animated\.Value \| undefined\s*>\(\s*undefined,?\s*\)/,
      );
      expect(read('lib/commonjs/contexts.js')).toMatch(
        /HeaderMinimizationContext = exports\.HeaderMinimizationContext = (?:\/\*#__PURE__\*\/)?[\w.]*createContext\(undefined\)/,
      );
      expect(read('lib/typescript/contexts.d.ts')).toContain(
        'HeaderMinimizationContext: React.Context<Animated.Value | undefined>',
      );
    });

    it('keeps the hook in a file of its own, beside useTransitionProgress, in every copy', () => {
      expect(read('src/useHeaderMinimization.tsx')).toContain(
        'export default function useHeaderMinimization()',
      );
      expect(read('src/useHeaderMinimization.tsx')).not.toContain('throw');
      expect(read('lib/commonjs/useHeaderMinimization.js')).toContain(
        'exports.default = useHeaderMinimization;',
      );
      expect(read('lib/commonjs/useHeaderMinimization.js')).not.toContain('throw');
      expect(read('lib/typescript/useHeaderMinimization.d.ts')).toContain(
        'export default function useHeaderMinimization(): Animated.Value | undefined;',
      );
    });

    it('exports the context and the hook from the package index, in every copy', () => {
      for (const path of ['src/index.tsx', 'lib/commonjs/index.js', 'lib/typescript/index.d.ts']) {
        expect(read(path)).toContain('HeaderMinimizationContext');
        expect(read(path)).toContain('useHeaderMinimization');
      }
    });

    it.each(SCREEN_COPIES)(
      'attaches one value to the header height event and provides it to the children, in %s',
      (path) => {
        const source = read(path);

        expect(source.match(/Animated\.Value\(0\)/g)).toHaveLength(4);
        expect(source).toMatch(
          /Animated\.attachNativeEvent\(\s*innerRef\.current,\s*'onHeaderHeightChange',\s*\[\s*\{\s*nativeEvent: \{\s*minimizedFraction: headerMinimization\s*\}\s*\}\s*\]/,
        );
        expect(source).toMatch(/return \(\) => \{?\s*attached\.detach\(\);?/);
        expect(source).toMatch(
          /HeaderMinimizationContext\.Provider[\s\S]{0,40}value(?:=\{|: )headerMinimization/,
        );
      },
    );

    // The ref callback is a new function on every render, so attaching from it would detach and
    // attach again at each render; the effect depends on the rendered native component instead.
    it.each(SCREEN_COPIES)(
      'attaches again when the rendered native component changes, not on every render, in %s',
      (path) => {
        const source = read(path);

        expect(source.indexOf('const AnimatedScreen =')).toBeLessThan(
          source.indexOf('attachNativeEvent'),
        );
        expect(source).toMatch(
          /\[\s*AnimatedScreen,\s*attachesHeaderMinimization,\s*headerMinimization\s*\]/,
        );
      },
    );

    // A value drops its native node when its last consumer unmounts, and the screen's attached
    // event goes on writing the dropped node. The view that never unmounts is last in the screen,
    // after the children: RNS and UIKit look for the large title's scroll view in the first
    // subview, so it must not be that.
    it.each([
      [
        'src/components/Screen.tsx',
        /\{children\}\s*\{\/\*[\s\S]*?\*\/\}\s*<Animated\.View\s+pointerEvents="none"\s+collapsable=\{false\}\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"\s+style=\{\{\s*position: 'absolute',\s*width: 0,\s*height: 0,\s*opacity: headerMinimization,\s*\}\}\s*\/>\s*<\/HeaderMinimizationContext\.Provider>/,
      ],
      [
        'lib/commonjs/components/Screen.js',
        /\}, children,(?:\s*\/\/[^\n]*)+\s*(?:\/\*#__PURE__\*\/)?_react\.default\.createElement\(_reactNative\.Animated\.View, \{\s*pointerEvents: "none",\s*collapsable: false,\s*accessibilityElementsHidden: true,\s*importantForAccessibility: "no-hide-descendants",\s*style: \{\s*position: 'absolute',\s*width: 0,\s*height: 0,\s*opacity: headerMinimization\s*\}\s*\}\)\)\)\)\);/,
      ],
    ])('keeps a view of the value after the children, hidden and empty, in %s', (path, pattern) => {
      const source = read(path);

      expect(source).toMatch(pattern);
      expect(source).toContain('Kiko patch: a value drops its native node when its last consumer');
    });

    it('reads undefined outside a screen and does not throw', async () => {
      const { useHeaderMinimization } = require('react-native-screens');
      const { result } = await renderHook(() => useHeaderMinimization());

      expect(result.current).toBeUndefined();
    });

    describe('on a mounted screen', () => {
      const mount = async (props: Record<string, unknown> = {}, isBandShown?: boolean) => {
        const { Screen, useHeaderMinimization } = require('react-native-screens');
        const seen: unknown[] = [];
        const handles: { detach: jest.Mock }[] = [];
        const attach = jest.spyOn(Animated, 'attachNativeEvent').mockImplementation(() => {
          handles.push({ detach: jest.fn() });

          return handles[handles.length - 1];
        });
        const Reader = () => {
          seen.push(useHeaderMinimization());

          return null;
        };
        // Reads the value in the component that stays mounted and draws a view of it only while
        // shown, as the DataTable band does under the Tables screen.
        const Band = ({ isShown }: { isShown: boolean }) => {
          const minimization = useHeaderMinimization();

          seen.push(minimization);

          return isShown
            ? createElement(Animated.View, { style: { opacity: minimization } })
            : null;
        };
        const element = (extra: Record<string, unknown>, isBandShown?: boolean) =>
          createElement(
            Screen,
            { isNativeStack: true, activityState: 2, ...props, ...extra },
            isBandShown === undefined
              ? createElement(Reader)
              : createElement(Band, { isShown: isBandShown }),
          );
        const rendered = await render(element({}, isBandShown));

        return { attach, handles, seen, rendered, element };
      };

      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('attaches the value the children read to onHeaderHeightChange of the native view', async () => {
        const { attach, seen } = await mount();

        expect(seen[0]).toBeInstanceOf(Animated.Value);
        expect(attach).toHaveBeenCalledTimes(1);
        expect(attach).toHaveBeenCalledWith(expect.anything(), 'onHeaderHeightChange', [
          { nativeEvent: { minimizedFraction: seen[0] } },
        ]);
      });

      it('detaches when the screen unmounts', async () => {
        const { handles, rendered } = await mount();

        await rendered.unmount();

        expect(handles.map((handle) => handle.detach.mock.calls.length)).toEqual([1]);
      });

      it('keeps one attachment across renders of the same native component', async () => {
        const { attach, rendered, element } = await mount();

        await rendered.rerender(element({ activityState: 2 }));

        expect(attach).toHaveBeenCalledTimes(1);
      });

      it('attaches the same value again when the presentation switches the native component', async () => {
        const { attach, handles, seen, rendered, element } = await mount();

        await rendered.rerender(element({ stackPresentation: 'modal' }));

        expect(attach).toHaveBeenCalledTimes(2);
        expect(handles[0].detach).toHaveBeenCalledTimes(1);
        expect(attach.mock.calls[1][2]).toEqual([{ nativeEvent: { minimizedFraction: seen[0] } }]);
        expect(seen[seen.length - 1]).toBe(seen[0]);
      });

      // A value whose last consumer unmounts drops its native node and the one attachment made
      // for the screen keeps writing the dropped one, so a consumer that comes back would sit
      // frozen. The listener is what the drop clears, in this JS-only environment too.
      it('keeps the value alive when its only view unmounts and comes back', async () => {
        const { attach, seen, rendered, element } = await mount({}, true);
        const listener = jest.fn();

        (seen[0] as Animated.Value).addListener(listener);
        await rendered.rerender(element({}, false));
        await rendered.rerender(element({}, true));
        await act(async () => (seen[0] as Animated.Value).setValue(0.5));

        expect(listener).toHaveBeenCalledWith({ value: 0.5 });
        expect(attach).toHaveBeenCalledTimes(1);
      });

      it('gives no value and attaches nothing outside a native stack', async () => {
        const { attach, seen } = await mount({ isNativeStack: false });

        expect(attach).not.toHaveBeenCalled();
        expect(seen[0]).toBeUndefined();
      });
    });
  });

  // In a split view with a top tab bar the per-tab hosting controller that parents the stack keeps
  // a safe top of 96 on a revisit (32 on the first visit), which drops the navigation bar 10 pt.
  // UIKit ignores a negative additional inset on the stack itself and honors one on the parent.
  describe('parent safe top inset', () => {
    it.each(sources)(
      'writes only while the fixed margin, a window and a tab bar hold, in %s',
      (_name, load) => {
        const sync = methodCode(load(), '- (void)syncParentSafeAreaTopInset');

        expect(sync).toContain('UIViewController *parent = self.parentViewController;');
        expect(sync).toContain('UIWindow *window = self.view.window;');
        expect(sync).toContain('UITabBarController *tabBarController = self.tabBarController;');
        expect(sync).toContain(
          'if (_fixedContentMargin <= 0 || parent == nil || !parent.isViewLoaded || window == nil || tabBarController == nil) { return; }',
        );
      },
    );

    // The inherited top subtracts the stored inset, so an ignored write reads back as a larger
    // inherited top and the target moves one step per write down to the clamp: at most
    // ceil(tab bar height / (parent top - window top)) writes, two for the measured 96, 32 and 72.
    // Only the source text is pinned here (no other assignment or safe area read feeds the target);
    // that UIKit then stops at that count is shown by the runtime check, not by Jest.
    it.each(sources)(
      'derives the target from the window and the stored inset only, so the writes are bounded by the clamp, in %s',
      (_name, load) => {
        const source = load();
        const sync = methodCode(source, '- (void)syncParentSafeAreaTopInset');

        expect(sync).toContain('UIEdgeInsets additional = parent.additionalSafeAreaInsets;');
        expect(sync).toContain(
          'CGFloat inheritedTop = parent.view.safeAreaInsets.top - additional.top;',
        );
        expect(sync).toContain('CGFloat tabBarHeight = tabBarController.tabBar.frame.size.height;');
        expect(sync).toContain(
          'CGFloat target = MIN(0, MAX(-tabBarHeight, window.safeAreaInsets.top - inheritedTop));',
        );
        expect(source.match(/\badditional\.top = [^;]+;/g)).toEqual([
          'additional.top = target;',
          'additional.top = 0;',
        ]);
        expect(source.match(/\.additionalSafeAreaInsets = [^;]+;/g)).toEqual([
          '.additionalSafeAreaInsets = additional;',
          '.additionalSafeAreaInsets = additional;',
        ]);
        expect(sync.match(/\w+\.(?:view\.)?safeAreaInsets\.\w+/g)).toEqual([
          'parent.view.safeAreaInsets.top',
          'window.safeAreaInsets.top',
        ]);
      },
    );

    it.each(sources)(
      'writes on the parent, not the stack, and only past half a point, in %s',
      (_name, load) => {
        const source = load();
        const sync = methodCode(source, '- (void)syncParentSafeAreaTopInset');

        expect(sync).toContain(
          'if (fabs(target - additional.top) > 0.5) { additional.top = target; parent.additionalSafeAreaInsets = additional;',
        );
        expect(source).not.toContain('self.additionalSafeAreaInsets');
        expect(sync).not.toMatch(/layoutIfNeeded|setNeedsLayout|dispatch_|NSTimer/);
      },
    );

    // Probe 3 wrote the parent only from the layout pass; a write from the safe area change hook
    // would change the parent during UIKit's own safe area propagation.
    it.each(sources)('runs only after each layout pass, in %s', (_name, load) => {
      const source = load();
      const layoutPass = methodCode(source, '- (void)viewDidLayoutSubviews');

      expect(layoutPass.indexOf('[self syncParentSafeAreaTopInset];')).toBeGreaterThan(
        layoutPass.indexOf('[self applyFixedContentMargin];'),
      );
      expect(source.match(/\[self syncParentSafeAreaTopInset\]/g)).toHaveLength(1);
      expect(source).not.toContain('viewSafeAreaInsetsDidChange');
    });

    it.each(sources)(
      'resets to 0 only what it wrote and only when no other stack is fixed, in %s',
      (_name, load) => {
        const source = load();
        const sync = methodCode(source, '- (void)syncParentSafeAreaTopInset');
        const release = methodCode(source, '- (void)releaseParentSafeAreaTopInset');
        const released = methodCode(source, '- (void)setFixedContentMargin:').slice(
          methodCode(source, '- (void)setFixedContentMargin:').indexOf('} else if (wasFixed) {'),
        );
        const leaving = methodCode(source, '- (void)willMoveToParentViewController:');

        expect(sync).toContain(
          'objc_setAssociatedObject( parent, &RNSParentSafeAreaTopInsetWrittenKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);',
        );
        expect(release).toContain(
          'objc_getAssociatedObject(parent, &RNSParentSafeAreaTopInsetWrittenKey) == nil) { return; }',
        );
        expect(release).toContain(
          'if (sibling != self && [sibling isKindOfClass:RNSNavigationController.class] && static_cast<RNSNavigationController *>(sibling).fixedContentMargin > 0) { return; }',
        );
        expect(release).toContain(
          'for (UIViewController *sibling in parent.childViewControllers) {',
        );
        expect(release).toContain(
          'additional.top = 0; parent.additionalSafeAreaInsets = additional;',
        );
        expect(release).toContain(
          'objc_setAssociatedObject( parent, &RNSParentSafeAreaTopInsetWrittenKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);',
        );
        expect(released).toContain('[self releaseParentSafeAreaTopInset];');
        expect(leaving).toContain(
          'if (parent != self.parentViewController) { [self releaseParentSafeAreaTopInset]; }',
        );
      },
    );
  });

  it('is applied to the codegen spec, the context and the stack that reads it', () => {
    expect(read('src/fabric/ScreenStackNativeComponent.ts')).toContain(
      'fixedContentMargin?: CT.WithDefault<CT.Float, 0>;',
    );
    expect(read('src/contexts.tsx')).toContain(
      'FixedContentMarginContext = React.createContext(0)',
    );
    expect(read('src/components/ScreenStack.tsx')).toContain(
      'fixedContentMargin={fixedContentMargin}',
    );
    expect(read('src/index.tsx')).toContain('FixedContentMarginContext');
  });

  it('is applied to the compiled and typed copies that Jest and the typecheck load', () => {
    expect(read('lib/commonjs/contexts.js')).toContain('FixedContentMarginContext');
    expect(read('lib/commonjs/index.js')).toContain('FixedContentMarginContext');
    expect(read('lib/commonjs/components/ScreenStack.js')).toContain(
      'fixedContentMargin: fixedContentMargin',
    );
    expect(read('lib/typescript/contexts.d.ts')).toContain('FixedContentMarginContext');
    expect(read('lib/typescript/index.d.ts')).toContain('FixedContentMarginContext');
    expect(read('lib/typescript/fabric/ScreenStackNativeComponent.d.ts')).toContain(
      'fixedContentMargin?:',
    );
  });

  it('reads 0 outside a provider, so a stack that is not a pane is untouched', async () => {
    const { FixedContentMarginContext } = require('react-native-screens');
    const seen: number[] = [];
    const Reader = () => {
      seen.push(useContext(FixedContentMarginContext));

      return null;
    };

    await render(createElement(Reader));

    expect(seen).toEqual([0]);
  });
});

// A patch edits node_modules silently after `npm ci`, so each one must be justified and
// re-checked on its package's upgrade in the exceptions inventory.
describe('the patch-package patches', () => {
  it('are each named in docs/harness/documented-exceptions.md', () => {
    const patchFiles = readdirSync(join(ROOT, 'patches')).filter((name) => name.endsWith('.patch'));
    const inventory = readFileSync(join(ROOT, 'docs/harness/documented-exceptions.md'), 'utf8');

    expect(patchFiles.length).toBeGreaterThan(0);
    expect(patchFiles.filter((name) => !inventory.includes(`patches/${name}`))).toEqual([]);
  });
});
