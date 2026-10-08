import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Row of swatches; wraps if the palette ever outgrows one line, mirroring the
  // ChipRow layout so the two labeled pickers read as one family.
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // The tappable ring around each swatch. A constant-width border keeps every
  // swatch the same size whether or not it is selected (a transparent ring when
  // unselected, a visible one when selected — set inline from the theme), so the
  // selection never shifts the row's layout.
  swatchRing: {
    padding: theme.spacing(1),
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The color disc itself. Its `backgroundColor` is the entity-color hex, set
  // inline (a runtime value, not a static token).
  swatch: {
    width: theme.spacing(7),
    height: theme.spacing(7),
    borderRadius: 999,
  },
}));
