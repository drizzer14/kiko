import type { FC } from 'react';
import Screen from '../../design-system/components/screen';

/**
 * Placeholder root for the Accounts tab. The real accounts list arrives in
 * Phase 3; for now this renders an empty screen so the tab's large-title
 * "Accounts" header (set in `accounts.stack.tsx`) shows and navigation is
 * complete and testable.
 */
const AccountsScreen: FC = () => <Screen />;

export default AccountsScreen;
