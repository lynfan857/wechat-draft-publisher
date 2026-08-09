import builtins from 'builtin-modules';
import esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('production');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
  banner: {
    js: '/* WeChat Draft Publisher for Obsidian */',
  },
  bundle: true,
  entryPoints: ['src/main.ts'],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: 'main.js',
  platform: 'node',
  sourcemap: production ? false : 'inline',
  target: 'es2022',
});

if (watch) {
  await context.watch();
  process.stdout.write('Watching WeChat Draft Publisher sources...\n');
} else {
  await context.rebuild();
  await context.dispose();
}
