// Generate `.env` from `.env.example` when it is missing, and append any key
// `.env.example` has gained since that a pre-existing `.env` still lacks, so
// a fresh checkout, worktree, or CI has a working `.env` (react-native-dotenv
// and Jest both read it) and an OLDER checkout's `.env` never goes stale
// after a `.env.example` key is added. Run from the `postinstall` npm
// script. Node builtins only — no new dependency. Never overwrites an
// existing key's value (local overrides survive), and never fails
// `npm install` (a missing template only warns).
//
// `KIKO_ENSURE_ENV_ROOT` is a test-only override seam (__tests__/ensure-env.test.ts
// runs this script against a temp directory); the real `postinstall`
// invocation never sets it, so it defaults to the repo root.

const fs = require('node:fs');
const path = require('node:path');

const root = process.env.KIKO_ENSURE_ENV_ROOT || path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

/** Maps each `KEY=...` line to its key, in file order. Ignores comments/blank lines. */
const parseEnvLinesByKey = (content) => {
  const entries = new Map();
  for (const line of content.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) {
      entries.set(match[1], line);
    }
  }
  return entries;
};

if (!fs.existsSync(examplePath)) {
  process.stderr.write('ensure-env: .env.example is missing; skipping .env generation\n');
  process.exit(0);
}

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  process.stdout.write('Created .env from .env.example\n');
  process.exit(0);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const existingKeys = parseEnvLinesByKey(envContent);
const exampleEntries = parseEnvLinesByKey(fs.readFileSync(examplePath, 'utf8'));

const missingLines = [...exampleEntries.entries()]
  .filter(([key]) => !existingKeys.has(key))
  .map(([, line]) => line);

if (missingLines.length > 0) {
  const separator = envContent.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(envPath, `${separator}${missingLines.join('\n')}\n`);
  process.stdout.write(`Appended ${missingLines.length} missing key(s) to .env\n`);
}
