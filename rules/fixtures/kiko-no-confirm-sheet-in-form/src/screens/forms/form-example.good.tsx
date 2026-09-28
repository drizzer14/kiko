// Semgrep fixture (NEGATIVE): kiko-design-system's "Component set
// (CardContextMenu)". Nothing here brings the confirm sheet into a form, so
// `kiko-no-confirm-sheet-in-form` (and every other rule) MUST report zero
// findings.

// A form's own buttons come from the shared Button; a form test reaches the
// page menu's confirm by its test id, never the sheet.
import Button from '@kiko/design-system/components/button';
import { DELETE_CONFIRM_TEST_ID } from '@kiko/design-system/components/card-context-menu';

// Prose that says import, then a quoted path on a later line: not a statement.
export const describedPath = "copied from '@kiko/design-system/components/confirm-sheet'";

// A test id that only names the sheet.
export const confirmSheetTestId = 'confirm-sheet';

export const usedBindings: [typeof Button, string] = [Button, DELETE_CONFIRM_TEST_ID];
