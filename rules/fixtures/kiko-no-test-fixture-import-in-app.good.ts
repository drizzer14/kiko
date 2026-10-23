// Semgrep fixture (NEGATIVE): none of these specifiers ends in a test-scaffolding name or sits
// under a scaffolding folder. `kiko-no-test-fixture-import-in-app` MUST report nothing here. The
// words test-fixtures in this comment and in the string below are text, not an import.
import { id } from '../../src/db/id';

export const label = 'the test-fixtures folder holds scaffolding';

export const newKey = id;
