import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${pkg.version}).`);
}

const releaseDir = join(root, '_release', manifest.id);
mkdirSync(releaseDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  copyFileSync(join(root, file), join(releaseDir, file));
}

const notes = [
  `# ${manifest.name} ${manifest.version}`,
  '',
  'Release files:',
  '',
  '- main.js',
  '- manifest.json',
  '- styles.css',
  '',
  'Manual install:',
  '',
  `1. Create <vault>/.obsidian/plugins/${manifest.id}/`,
  '2. Copy the three release files into that folder.',
  '3. Reload Obsidian and enable the plugin.',
  '',
].join('\n');

writeFileSync(join(root, '_release', 'RELEASE.md'), notes, 'utf8');
console.log(`Prepared release files in ${releaseDir}`);
