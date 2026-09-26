// Semgrep fixture (POSITIVE): a shared, non-screens module importing from
// `src/screens/**` — the exact layer inversion `FieldTrigger` used to be
// before it moved from `src/screens/forms/field-trigger/` into
// `src/design-system/components/field-trigger/` (skill-gap-analysis #14).
// `kiko-no-import-screens-outside-ui` MUST report a finding on each of the
// two pinned lines below: a static `import` reaching into `src/screens/`,
// and a dynamic `require(...)` doing the same. Never "fix" this file.
// `AddTransactionFab` (not `EntityHeaderIcon`) is the pinned target here
// because `EntityHeaderIcon` itself moved out of `src/screens/` into
// `src/design-system/components/` under Task 18 (`kiko-no-cross-screen-import`)
// — any still-screen-owned default-exported component works equally well as
// this rule's positive case, since the rule matches the literal path prefix,
// never the imported module's own identity.
import Box from '../../src/design-system/components/box';
// EXPECT-FINDING
import AddTransactionFab from '../../src/screens/home/add-transaction-fab';

export const renderBoxedIcon = (): [typeof Box, typeof AddTransactionFab] => [
  Box,
  AddTransactionFab,
];

export const lazyLoadEntityHeaderIcon = async (): Promise<unknown> => {
  const mod =
    // EXPECT-FINDING
    require('../../src/screens/home/add-transaction-fab') as typeof import('../../src/screens/home/add-transaction-fab');

  return mod;
};
