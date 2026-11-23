// Сборка: node build.mjs
import * as esbuild from 'esbuild';

const banner = '/* SoftFlesh.js v1.0.0 — мягкие деформации для веб-игр на Three.js. Требует three >= 0.150 */';
const globalThree = {
  name: 'global-three',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'gthree' }));
    b.onLoad({ filter: /.*/, namespace: 'gthree' }, () => ({ contents: 'module.exports = globalThis.THREE;', loader: 'js' }));
  },
};
const common = { entryPoints: ['src/index.js'], bundle: true, target: 'es2020', banner: { js: banner }, legalComments: 'none', charset: 'utf8' };

await esbuild.build({ ...common, format: 'esm', external: ['three'], outfile: 'dist/softflesh.module.js' });
await esbuild.build({ ...common, format: 'esm', external: ['three'], minify: true, outfile: 'dist/softflesh.module.min.js' });
await esbuild.build({ ...common, format: 'cjs', external: ['three'], outfile: 'dist/softflesh.cjs' });
await esbuild.build({ ...common, format: 'iife', globalName: 'SoftFlesh', plugins: [globalThree], outfile: 'dist/softflesh.js' });
await esbuild.build({ ...common, format: 'iife', globalName: 'SoftFlesh', plugins: [globalThree], minify: true, outfile: 'dist/softflesh.min.js' });
console.log('dist/ готов');
