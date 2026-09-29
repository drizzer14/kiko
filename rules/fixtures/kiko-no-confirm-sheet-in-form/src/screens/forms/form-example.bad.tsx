// Semgrep fixture (POSITIVE): kiko-design-system's "Component set
// (CardContextMenu)". A form has no in-form Delete: an entity is deleted
// only from its page's touch-and-hold CardContextMenu, which owns the
// confirm. `kiko-no-confirm-sheet-in-form` MUST report a finding on every
// pinned line below: each one brings the confirm sheet into a form.

// The default import app code writes.
// EXPECT-FINDING
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';

export const defaultBinding = ConfirmSheet;

// The component file itself, reached past its barrel.
// EXPECT-FINDING
import DeepConfirmSheet from '@kiko/design-system/components/confirm-sheet/confirm-sheet.component';

export const deepBinding = DeepConfirmSheet;

// A clause spread over several lines.
// EXPECT-FINDING
import {
  default as MultiLineConfirmSheet,
} from '@kiko/design-system/components/confirm-sheet';

export const multiLineBinding = MultiLineConfirmSheet;

// A type-only import still plans a confirm the form must not own.
// EXPECT-FINDING
import type { ConfirmSheetProps } from '@kiko/design-system/components/confirm-sheet/confirm-sheet.props';

export type TypeBinding = ConfirmSheetProps;

// A re-export.
// EXPECT-FINDING
export { default as ReExportedConfirmSheet } from '@kiko/design-system/components/confirm-sheet';

// A CommonJS load.
// EXPECT-FINDING
export const requiredConfirmSheet = require('@kiko/design-system/components/confirm-sheet').default;

// A dynamic load.
// EXPECT-FINDING
export const loadConfirmSheetLater = () => import('@kiko/design-system/components/confirm-sheet');
