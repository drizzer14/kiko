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

  // In a split view with a top tab bar the per-tab hosting controller that parents the stack keeps
  // a safe top of 96 on a revisit (32 on the first visit), which drops the navigation bar 10 pt.
  // UIKit ignores a negative additional inset on the stack itself and honors one on the parent.
  describe('parent safe top inset', () => {
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
    // A method's code up to the next method, comments dropped and whitespace collapsed.
    const methodCode = (source: string, signature: string) => {
      const start = source.indexOf(signature);
      const end = source.indexOf('\n- (', start + 1);

      return source
        .slice(start, end)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join(' ')
        .replace(/\s+/g, ' ');
    };

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

    it.each(sources)(
      'targets the window safe top, clamped to the tab bar height, in %s',
      (_name, load) => {
        const sync = methodCode(load(), '- (void)syncParentSafeAreaTopInset');

        expect(sync).toContain('UIEdgeInsets additional = parent.additionalSafeAreaInsets;');
        expect(sync).toContain(
          'CGFloat inheritedTop = parent.view.safeAreaInsets.top - additional.top;',
        );
        expect(sync).toContain('CGFloat tabBarHeight = tabBarController.tabBar.frame.size.height;');
        expect(sync).toContain(
          'CGFloat target = MIN(0, MAX(-tabBarHeight, window.safeAreaInsets.top - inheritedTop));',
        );
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

    it.each(sources)('runs after each layout and each safe area change, in %s', (_name, load) => {
      const source = load();
      const layoutPass = methodCode(source, '- (void)viewDidLayoutSubviews');
      const safeAreaChange = methodCode(source, '- (void)viewSafeAreaInsetsDidChange');

      expect(layoutPass.indexOf('[self syncParentSafeAreaTopInset];')).toBeGreaterThan(
        layoutPass.indexOf('[self applyFixedContentMargin];'),
      );
      expect(layoutPass).toContain('[self syncParentSafeAreaTopInset];');
      expect(safeAreaChange).toContain('[super viewSafeAreaInsetsDidChange];');
      expect(safeAreaChange).toContain('[self syncParentSafeAreaTopInset];');
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

    // UIKit ignoring the write cannot grow the inset: the inherited top subtracts the stored
    // inset, so an ignored -64 reads back as a 160 inherited top, the target clamps to the tab bar
    // height and the next pass finds the same target. Only the source text is pinned here; that
    // UIKit then stops at the second write is shown by the runtime check, not by Jest.
    it.each(sources)(
      'cannot ratchet: the target depends on the window and the stored inset only, in %s',
      (_name, load) => {
        const source = load();
        const sync = methodCode(source, '- (void)syncParentSafeAreaTopInset');

        expect(source.match(/\badditional\.top = [^;]+;/g)).toEqual([
          'additional.top = target;',
          'additional.top = 0;',
        ]);
        expect(source.match(/\.additionalSafeAreaInsets = [^;]+;/g)).toEqual([
          '.additionalSafeAreaInsets = additional;',
          '.additionalSafeAreaInsets = additional;',
        ]);
        expect(sync.match(/\bparent\.additionalSafeAreaInsets\b/g)).toHaveLength(2);
        expect(sync.match(/\w+\.(?:view\.)?safeAreaInsets\.\w+/g)).toEqual([
          'parent.view.safeAreaInsets.top',
          'window.safeAreaInsets.top',
        ]);
        expect(sync.match(/CGFloat \w+ = [^;]+;/g)).toEqual([
          'CGFloat inheritedTop = parent.view.safeAreaInsets.top - additional.top;',
          'CGFloat tabBarHeight = tabBarController.tabBar.frame.size.height;',
          'CGFloat target = MIN(0, MAX(-tabBarHeight, window.safeAreaInsets.top - inheritedTop));',
        ]);
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
