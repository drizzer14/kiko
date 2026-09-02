import { render } from '@testing-library/react-native';
import '../../unistyles';
// Aliased to SymbolIcon, not Symbol: importing the default export as
// `Symbol` shadows the global `Symbol` constructor
// (lint/suspicious/noShadowRestrictedNames) at every call site, not just
// inside this component's own file. Every consumer (this test, and screens
// once wired) must import it under a different local name. Imported through
// the folder's index (the real path a screen consumes,
// `design-system/components/symbol`), not `./symbol.component` directly, so
// this test also exercises index.ts's re-export.
import SymbolIcon from '.';

describe('Symbol', () => {
  it('renders without crashing (react-native-nitro-sfsymbols is mocked under Jest)', async () => {
    const { toJSON } = await render(<SymbolIcon name="heart.fill" accessibilityLabel="Favorite" />);

    expect(toJSON()).toBeTruthy();
  });
});
