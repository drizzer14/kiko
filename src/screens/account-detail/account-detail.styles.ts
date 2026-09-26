import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A leading-icon status line: keeps the SF Symbol vertically centered against
  // its adjacent status text (token result, last-sync time), and the sync
  // action beside its last-sync status.
  statusLine: {
    alignItems: 'center',
  },
  // The balance block sits directly under the large navigation title, so give
  // it breathing room at the top rather than crowding the heading against the
  // header — matching the roomier feel of the rest of the screen.
  balanceBlock: {
    paddingTop: theme.spacing(2),
  },
  // Extra space above the per-currency breakdown so it reads as a distinct
  // block beneath the headline number rather than crowding right under it.
  breakdown: {
    marginTop: theme.spacing(3),
  },
}));
