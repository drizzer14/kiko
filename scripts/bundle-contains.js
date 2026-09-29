// Proves a freshly built main.jsbundle holds a known-new string, so
// scripts/deploy-device.sh can refuse to install a stale bundle.
// Usage: node scripts/bundle-contains.js <bundle path> <string>
// Exit: 0 found, 1 not found, 2 usage error or unreadable bundle.

const fs = require('node:fs');

const [bundlePath, needle] = process.argv.slice(2);

if (!bundlePath || !needle) {
  process.stderr.write('usage: node scripts/bundle-contains.js <bundle path> <string>\n');
  process.exit(2);
}

let bundle;

try {
  bundle = fs.readFileSync(bundlePath);
} catch (error) {
  process.stderr.write(`bundle-contains: cannot read ${bundlePath}: ${error.message}\n`);
  process.exit(2);
}

// Hermes stores a whole string literal as UTF-16LE once any character in it
// is non-ASCII, ASCII words included, so a UTF-8-only search would call a
// fresh bundle stale.
const found = ['utf8', 'utf16le'].some((encoding) =>
  bundle.includes(Buffer.from(needle, encoding)),
);

process.exit(found ? 0 : 1);
