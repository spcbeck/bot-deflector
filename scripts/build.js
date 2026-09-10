import { build } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';

const rootDir = resolve(import.meta.dirname, '..');

async function run() {
  console.log('▶ [1/3] Building Background Service Worker & Popup Dashboard...');
  await build({
    root: rootDir,
    base: '',
    publicDir: 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: {
        input: {
          background: resolve(rootDir, 'src/background/index.ts'),
          popup: resolve(rootDir, 'src/popup/index.html')
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === 'background') return 'background.js';
            return 'popup/[name].js';
          },
          assetFileNames: (asset) => {
            if (asset.name?.endsWith('.css')) return 'popup/popup.css';
            return 'assets/[name][extname]';
          }
        }
      }
    }
  });

  console.log('▶ [2/3] Building Self-Contained Content Script (IIFE format)...');
  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      target: 'es2022',
      rollupOptions: {
        input: {
          content: resolve(rootDir, 'src/content/index.ts')
        },
        output: {
          format: 'iife',
          entryFileNames: 'content.js'
        }
      }
    }
  });

  console.log('▶ [3/3] Copying content CSS, manifest, and finalizing popup...');
  fs.copyFileSync(
    resolve(rootDir, 'src/content/content.css'),
    resolve(rootDir, 'dist/content.css')
  );
  fs.copyFileSync(
    resolve(rootDir, 'manifest.json'),
    resolve(rootDir, 'dist/manifest.json')
  );

  // Ensure dist/popup directory exists and move index.html
  const distPopupDir = resolve(rootDir, 'dist/popup');
  if (!fs.existsSync(distPopupDir)) {
    fs.mkdirSync(distPopupDir, { recursive: true });
  }

  const generatedHtmlPath = resolve(rootDir, 'dist/src/popup/index.html');
  const targetHtmlPath = resolve(rootDir, 'dist/popup/index.html');
  if (fs.existsSync(generatedHtmlPath)) {
    let html = fs.readFileSync(generatedHtmlPath, 'utf8');
    // Adjust paths if needed
    html = html.replace(/(?:src|href)="\.\.\/\.\.\/popup\//g, (m) => m.startsWith('src') ? 'src="./' : 'href="./');
    fs.writeFileSync(targetHtmlPath, html);
    fs.rmSync(resolve(rootDir, 'dist/src'), { recursive: true, force: true });
  }

  console.log('✔ Build successful! Output in dist/');
}

run().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
