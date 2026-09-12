// Generate `.env` from `.env.example` when it is missing, so a fresh checkout,
// worktree, or CI has a working `.env` (react-native-dotenv and Jest both read
// it). Run from the `postinstall` npm script. Node builtins only — no new
// dependency. Never overwrites an existing `.env` (local overrides survive),
// and never fails `npm install` (a missing template only warns).

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (fs.existsSync(envPath)) {
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  process.stderr.write('ensure-env: .env.example is missing; skipping .env generation\n');
  process.exit(0);
}

fs.copyFileSync(examplePath, envPath);
process.stdout.write('Created .env from .env.example\n');
