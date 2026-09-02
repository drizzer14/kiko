import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable range field: a bordered, filled chip matching the Accounts /
  // Categories dropdowns' chrome (same border, fill, radius, padding) so the
  // three filter controls read as one consistent row. A leading calendar icon
  // sits before the range label.
  field: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  // The full-screen scrim behind the bottom sheet. True-black is on-brand for
  // the OLED theme; a tap on it dismisses the modal without applying. The sheet
  // is pinned to the bottom edge so it reads as a flush bottom sheet.
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.background,
  },
  // The calendar sheet: flush to the screen's left/right edges with only its
  // top corners rounded and no surrounding border or inset — a clean sheet, no
  // bezel or floating card frame. This Modal renders outside any
  // SafeAreaView, so the bottom edge must add the bottom safe-area inset (the
  // home indicator's zone) itself on top of the base padding, or the sheet's
  // Clear/Apply row sits flush against it — `bottomInset` is
  // `useSafeAreaInsets().bottom` from the call site.
  sheet: (bottomInset: number) => ({
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    backgroundColor: theme.colors.surfaceHigh,
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4) + bottomInset,
  }),
  // The Clear/Apply action row, pushed to the trailing edge of the sheet.
  actions: {
    justifyContent: 'flex-end',
  },
}));
