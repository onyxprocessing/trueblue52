import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function buildClean() {
  try {
    // Clean previous builds
    const distDir = join(rootDir, 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir, { recursive: true });

    // Build API with esbuild (fast and reliable)
    await build({
      entryPoints: [join(rootDir, 'api/index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: join(distDir, 'api/index.js'),
      external: [
        'express',
        'compression',
        '@neondatabase/serverless',
        'drizzle-orm',
        'airtable',
        'stripe'
      ],
      minify: false,
      sourcemap: false,
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });

    console.log('✓ API build completed successfully');
    console.log('✓ Zero build errors achieved');
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildClean();