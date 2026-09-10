import { build } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';

const rootDir = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(resolve(rootDir, 'package.json'), 'utf8'));

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         BotDeflector for Reddit
// @namespace    https://github.com/spcbeck/bot-deflector
// @version      ${pkg.version}
// @description  Detects and stealthily deflects automated bots, viral repost farms, and hijacked comments across Reddit.
// @author       ${pkg.author || 'spcbeck'}
// @match        https://*.reddit.com/*
// @match        https://reddit.com/*
// @icon         https://raw.githubusercontent.com/spcbeck/bot-deflector/main/public/icons/icon-128.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

`;

async function run() {
  console.log('▶ [Userscript] Compiling BotDeflector Userscript bundle...');

  const tempOutDir = resolve(rootDir, 'dist/userscript-temp');

  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: tempOutDir,
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: {
        input: {
          userscript: resolve(rootDir, 'src/userscript/index.ts')
        },
        output: {
          format: 'iife',
          entryFileNames: 'bundle.js'
        }
      }
    }
  });

  const bundledCode = fs.readFileSync(resolve(tempOutDir, 'bundle.js'), 'utf8');
  const finalUserscript = USERSCRIPT_HEADER + bundledCode;

  // Write to dist/bot-deflector.user.js
  const distPath = resolve(rootDir, 'dist/bot-deflector.user.js');
  fs.writeFileSync(distPath, finalUserscript, 'utf8');

  // Also write to repository root for convenient raw GitHub link access
  const rootPath = resolve(rootDir, 'bot-deflector.user.js');
  fs.writeFileSync(rootPath, finalUserscript, 'utf8');

  // Clean up temp directory
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  console.log(`✔ Userscript created: ${distPath} & ${rootPath}`);
}

run().catch((err) => {
  console.error('[Userscript Build Error]', err);
  process.exit(1);
});
