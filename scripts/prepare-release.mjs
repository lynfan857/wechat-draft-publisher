import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${pkg.version}).`);
}

const releaseDir = join(root, '_release', manifest.id);
mkdirSync(releaseDir, { recursive: true });

const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];

for (const file of releaseFiles) {
  copyFileSync(join(root, file), join(releaseDir, file));
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function writeZip(files, outputPath) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const file of files) {
    const name = Buffer.from(file, 'utf8');
    const body = readFileSync(join(releaseDir, file));
    const compressed = deflateRawSync(body);
    const checksum = crc32(body);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(now.dosTime, 10);
    localHeader.writeUInt16LE(now.dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(now.dosTime, 12);
    centralHeader.writeUInt16LE(now.dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
  const endHeader = Buffer.alloc(22);
  endHeader.writeUInt32LE(0x06054b50, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(files.length, 8);
  endHeader.writeUInt16LE(files.length, 10);
  endHeader.writeUInt32LE(centralSize, 12);
  endHeader.writeUInt32LE(centralOffset, 16);
  endHeader.writeUInt16LE(0, 20);

  writeFileSync(outputPath, Buffer.concat([...chunks, ...centralDirectory, endHeader]));
}

const zipPath = join(root, '_release', `${manifest.id}-${manifest.version}.zip`);
writeZip(releaseFiles, zipPath);

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
console.log(`Prepared release zip at ${zipPath}`);
