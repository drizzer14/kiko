import { join } from 'node:path';
import { createElement, useContext } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { render } from '@testing-library/react-native';

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

const SCREENS_PATCH_FILE = 'patches/react-native-screens+4.27.0.patch';
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

    expect(manifest.dependencies['react-native-screens']).toBe('4.27.0');
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
