import { render } from '@testing-library/react-native';
import '../../unistyles';

import { entityIconTileGradient } from '../../entity-tint';
import { darkTheme } from '../../theme';

import EntityIconTile, { ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT } from '.';

// This suite covers the CURRENT default,
// `ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT === true` (the squircle-gradient
// tile) — see that flag's own doc comment in entity-icon-tile.component.tsx
// for how to review/revert. The `false` branch is a straight passthrough to
// `SymbolIcon` (the exact markup every call site inlined before this
// component existed), already covered by symbol.component.test.tsx; this
// suite would only re-test that component's own behavior a second time.
describe('EntityIconTile', () => {
  it('is the squircle-gradient experiment as shipped for review', () => {
    expect(ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT).toBe(true);
  });

  it('renders the squircle gradient fill and the glyph on top', async () => {
    const { getByTestId, getByLabelText } = await render(
      <EntityIconTile name="banknote" color="#0A84FF" accessibilityLabel="Checking icon" />,
    );

    expect(getByTestId('entity-icon-tile')).toBeTruthy();
    expect(getByTestId('entity-icon-tile-gradient-svg')).toBeTruthy();
    expect(getByLabelText('Checking icon')).toBeTruthy();
  });

  it("derives the gradient's two stops from the entity color via entityIconTileGradient", async () => {
    const [top, bottom] = entityIconTileGradient('#0A84FF');
    const { getByTestId } = await render(<EntityIconTile name="banknote" color="#0A84FF" />);

    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it('tints the glyph with the legible onAccent token on a dark tile, never the raw entity color directly', async () => {
    const { getByLabelText } = await render(
      <EntityIconTile name="banknote" color="#0A84FF" accessibilityLabel="Checking icon" />,
    );

    expect(getByLabelText('Checking icon').props.tintColor).toBe(darkTheme.colors.onAccent);
  });

  // DEVICE BUG (review, 2026-09-13): a fixed white glyph fails WCAG AA on a
  // light entity swatch (e.g. `white`, `yellow` — see `isLightEntityColor`'s
  // doc comment in `entity-tint.ts`). The glyph must switch to the dark
  // `theme.colors.background` token instead of staying white on a tile this
  // bright.
  it('tints the glyph with the dark background token on a light tile', async () => {
    const { getByLabelText } = await render(
      <EntityIconTile
        name="banknote"
        color={darkTheme.colors.entityColors.white}
        accessibilityLabel="Savings icon"
      />,
    );

    expect(getByLabelText('Savings icon').props.tintColor).toBe(darkTheme.colors.background);
  });

  it('tints the glyph with the dark background token on the yellow swatch', async () => {
    const { getByLabelText } = await render(
      <EntityIconTile
        name="banknote"
        color={darkTheme.colors.entityColors.yellow}
        accessibilityLabel="Cash icon"
      />,
    );

    expect(getByLabelText('Cash icon').props.tintColor).toBe(darkTheme.colors.background);
  });

  // Cheap safety (review, 2026-09-13): the accounts grid mounts many tiles at
  // once with different gradient stops. Each tile must derive its own
  // gradient id via `useId()` rather than sharing one static id, so no two
  // simultaneously-mounted tiles can ever collide.
  it('gives each simultaneously-mounted tile its own gradient id', async () => {
    const { getAllByTestId } = await render(
      <>
        <EntityIconTile name="banknote" color="#0A84FF" />
        <EntityIconTile name="banknote" color="#FF453A" />
      </>,
    );

    const [firstGradient, secondGradient] = getAllByTestId('entity-icon-tile-linear-gradient');
    const [firstRect, secondRect] = getAllByTestId('entity-icon-tile-gradient-rect');

    expect(firstGradient.props.id).not.toBe(secondGradient.props.id);
    expect(firstRect.props.fill).toBe(`url(#${firstGradient.props.id})`);
    expect(secondRect.props.fill).toBe(`url(#${secondGradient.props.id})`);
  });

  it('passes an explicit size through to the glyph', async () => {
    const { getByLabelText } = await render(
      <EntityIconTile
        name="banknote"
        color="#0A84FF"
        accessibilityLabel="Checking icon"
        size={40}
      />,
    );

    expect(getByLabelText('Checking icon').props.size).toBe(40);
  });
});
