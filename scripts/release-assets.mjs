import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareReleaseAssets(inputDirectory, outputDirectory) {
  if (!(await lstat(resolve(inputDirectory))).isDirectory()) {
    throw new Error('Release input must be a directory, not a symlink.');
  }
  const input = await realpath(inputDirectory);
  const output = resolve(outputDirectory);
  // Resolve the existing parent too: macOS temporary paths may alias /private/var through /var.
  const canonicalOutput = join(await realpath(dirname(output)), basename(output));
  if (input === canonicalOutput || canonicalOutput.startsWith(`${input}${sep}`) || input.startsWith(`${canonicalOutput}${sep}`)) {
    throw new Error('Release input and output directories must not overlap.');
  }

  const pending = [input];
  const files = new Map();
  const uniqueNames = new Set();
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(source);
        continue;
      }
      if (!entry.isFile()) throw new Error('Release assets must be regular files; symlinks are not allowed.');
      const match = entry.name.match(/^SakaiClient-[A-Za-z0-9][A-Za-z0-9._-]*\.(?:apk|ipa|zip|exe|dmg|AppImage)$/);
      if (!match || match[0] !== entry.name || entry.name.length > 200) {
        throw new Error('Release assets must have safe SakaiClient distributable filenames.');
      }
      const key = entry.name.toLowerCase();
      if (uniqueNames.has(key)) throw new Error(`Duplicate release asset name: ${entry.name}`);
      uniqueNames.add(key);
      files.set(entry.name, source);
    }
  }
  if (files.size === 0) throw new Error('No release assets were found.');

  // A fresh directory and exclusive copies prevent accidental replacement on retries.
  await mkdir(output);
  const assets = [];
  const checksums = [];
  for (const name of [...files.keys()].sort()) {
    const destination = join(output, name);
    await copyFile(files.get(name), destination, constants.COPYFILE_EXCL);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    checksums.push(`${hash.digest('hex')}  ${name}\n`);
    assets.push(destination);
  }
  const checksumPath = join(output, 'SHA256SUMS.txt');
  await writeFile(checksumPath, checksums.join(''), { flag: 'wx' });
  return { assets, checksumPath };
}

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length > 0) {
    throw new Error('Usage: node scripts/release-assets.mjs <download-directory> <new-output-directory>');
  }
  const result = await prepareReleaseAssets(input, output);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
