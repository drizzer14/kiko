// Semgrep fixture (NEGATIVE): none of these specifiers ends in a test-scaffolding name.
// `kiko-no-test-fixture-import-in-app` MUST report nothing here. The words test-fixtures in this
// comment and in the string below are text, not an import.
import { SEEDED_CATEGORIES } from '../../src/db/__fixtures__/seeded-categories';

export const label = 'the test-fixtures folder holds scaffolding';

export const categories = SEEDED_CATEGORIES;
