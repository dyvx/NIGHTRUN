import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const CACHE_VERSION = 'nightrun-v1';

/** Recursively collect every emitted file, relative to `base`. */
function walk(dir, base, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

let outDir = 'dist';

/**
 * Tiny, dependency-free service-worker generator.
 * - Copies public/sw.js -> dist/sw.js
 * - Injects a manifest of every emitted asset so the SW can precache the whole
 *   game (JS chunks, CSS, icons, webmanifest, offline page) on install.
 */
function serviceWorkerPlugin() {
  return {
    name: 'nightrun-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const dist = outDir;
      const templatePath = join('public', 'sw.js');
      if (!existsSync(templatePath)) throw new Error('public/sw.js missing');

      const files = walk(dist, dist).filter(
        (f) => f !== 'sw.js' && !f.endsWith('.map') && !f.endsWith('.DS_Store'),
      );
      const hash = createHash('sha256')
        .update(files.slice().sort().join('|'))
        .update(CACHE_VERSION)
        .digest('hex')
        .slice(0, 12);

      const template = readFileSync(templatePath, 'utf8');
      const out = template
        .replace('__CACHE_VERSION__', `${CACHE_VERSION}-${hash}`)
        .replace('__PRECACHE_MANIFEST__', JSON.stringify(files));

      if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'sw.js'), out);
      console.log(`\n  nightrun SW: ${files.length} files precached (${CACHE_VERSION}-${hash})\n`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorkerPlugin()],
  build: {
    target: 'es2019',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
        assetFileNames: (info) => {
          const ext = extname(info.name || '');
          if (ext === '.css') return 'assets/style-[hash][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
});
