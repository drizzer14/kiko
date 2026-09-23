// Semgrep fixture (POSITIVE): a shared, non-screens module importing from
// `src/screens/**` — the exact layer inversion `FieldTrigger` used to be
// before it moved from `src/screens/forms/field-trigger/` into
// `src/design-system/components/field-trigger/` (skill-gap-analysis #14).
// `kiko-no-import-screens-outside-ui` MUST report a finding on each of the
// two pinned lines below: a static `import` reaching into `src/screens/`,
// and a dynamic `require(...)` doing the same. Never "fix" this file.
import Box from '../../src/design-system/components/box';

// EXPECT-FINDING
import EntityHeaderIcon from '../../src/screens/entity-header-icon';

export const renderBoxedIcon = (): [typeof Box, typeof EntityHeaderIcon] => [
  Box,
  EntityHeaderIcon,
];

export const lazyLoadEntityHeaderIcon = async (): Promise<unknown> => {
  const mod =
    // EXPECT-FINDING
    require('../../src/screens/entity-header-icon') as typeof import('../../src/screens/entity-header-icon');

  return mod;
};
