const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

const requiredPaths = [
  ['built web app', 'web', 'dist', 'index.html'],
  ['backend entry', 'server', 'server.js'],
  ['backend package', 'server', 'package.json'],
  ['backend Express dependency', 'server', 'node_modules', 'express', 'package.json'],
  ['backend ws dependency', 'server', 'node_modules', 'ws', 'package.json'],
  ['desktop Windows icon', 'desktop', 'assets', 'icon.ico'],
  ['MT5 EA source', 'mt5', 'MT5_Dashboard_Bridge.mq5']
];

const missing = requiredPaths
  .map(([label, ...segments]) => ({
    label,
    filePath: path.join(projectRoot, ...segments)
  }))
  .filter((item) => !fs.existsSync(item.filePath));

if (missing.length > 0) {
  console.error('Electron production files are not ready.');

  for (const item of missing) {
    console.error(`Missing ${item.label}: ${item.filePath}`);
  }

  console.error('Run from the project root: npm run build:desktop');
  console.error('If backend dependencies are missing, run: cd server && npm install');
  process.exit(1);
}

const releaseDir = path.join(projectRoot, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

console.log('Electron production files are ready.');
console.log(`Release output directory: ${releaseDir}`);
