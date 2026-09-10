import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const distDir = resolve(rootDir, 'dist');
const pkg = JSON.parse(fs.readFileSync(resolve(rootDir, 'package.json'), 'utf8'));

const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'popup/index.html',
  'popup/popup.js',
  'popup/popup.css',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];

function checkIntegrity() {
  console.log('▶ [Package] Validating dist/ files for Chrome Web Store release...');
  for (const relPath of REQUIRED_FILES) {
    const fullPath = resolve(distDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing required distribution file: ${relPath}`);
    }
  }
  console.log('✔ All required extension files present in dist/');
}

function createZip() {
  const version = pkg.version || '1.0.0';
  const zipName = `bot-deflector-v${version}.zip`;
  const zipPath = resolve(rootDir, zipName);
  const latestZipPath = resolve(rootDir, 'bot-deflector.zip');

  // Remove existing zip if any
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (fs.existsSync(latestZipPath)) fs.unlinkSync(latestZipPath);

  console.log(`▶ [Package] Compressing dist/ into ${zipName}...`);

  // Compress dist/ contents directly (excluding hidden/DS_Store/temp files)
  execSync(`zip -r -q "${zipPath}" . -x ".*" -x "__MACOSX*" -x "*.user.js" -x "userscript-temp/*"`, {
    cwd: distDir
  });

  // Also create canonical bot-deflector.zip copy
  fs.copyFileSync(zipPath, latestZipPath);

  const stats = fs.statSync(zipPath);
  console.log(`✔ Package created successfully: ${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`✔ Canonical copy created: bot-deflector.zip`);
}

try {
  checkIntegrity();
  createZip();
} catch (err) {
  console.error('[Packaging Failed]', err);
  process.exit(1);
}
