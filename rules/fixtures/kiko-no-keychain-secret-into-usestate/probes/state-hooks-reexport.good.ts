// Semgrep fixture (NEGATIVE, helper): re-exports react's useState so the sibling
// reexported-use-state.bad.ts reaches useState WITHOUT importing react itself. It holds no
// secret flow, so it reports nothing.
export { useState } from 'react';
