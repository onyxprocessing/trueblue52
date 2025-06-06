import { build } from 'esbuild';
import path from 'path';

async function buildApi() {
  try {
    await build({
      entryPoints: ['api/index.ts'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: 'dist/api/index.js',
      external: ['express', 'compression'],
      minify: false,
      sourcemap: false,
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });
    console.log('API build successful');
  } catch (error) {
    console.error('API build failed:', error);
    process.exit(1);
  }
}

buildApi();