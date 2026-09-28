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

// Hermes stores a non-ASCII string literal as UTF-16LE, so a UTF-8-only
// search would call a fresh bundle stale.
const isAscii = Buffer.byteLength(needle, 'utf8') === needle.length;
const encodings = isAscii ? ['utf8'] : ['utf8', 'utf16le'];
const found = encodings.some((encoding) => bundle.includes(Buffer.from(needle, encoding)));

process.exit(found ? 0 : 1);
