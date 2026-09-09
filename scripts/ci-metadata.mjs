import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(version) {
  const match = typeof version === 'string' && version.length <= 128 ? version.match(versionPattern) : null;
  if (!match || match[0] !== version || match.slice(1, 4).some((part) => Number(part) > 65535) ||
      match[4]?.split('.').some((part) => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('Version must be X.Y.Z[-prerelease], at most 128 characters, with core components in 0..65535 and no numeric leading zeros.');
  }
  return {
    version,
    native_version: match.slice(1, 4).join('.'),
    prerelease: match[4] !== undefined,
  };
}

export function parseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) {
    throw new Error('Release tag must start with v and contain a valid version.');
  }
  return parseVersion(tag.slice(1));
}

export function createMetadata({ refType, refName, runNumber, packageVersion }) {
  if (!['branch', 'tag'].includes(refType)) {
    throw new Error('GitHub ref type must be branch or tag.');
  }
  const number = Number(runNumber);
  if (typeof runNumber !== 'string' || !Number.isSafeInteger(number) || number < 1 ||
      number > 2100000000 || String(number) !== runNumber) {
    throw new Error('CI run number must be a canonical decimal integer in 1..2100000000.');
  }
  // Branch names are intentionally ignored instead of being embedded in versions or shell commands.
  const version = refType === 'tag' ? parseTag(refName) : parseVersion(packageVersion);
  return { ...version, build_number: runNumber };
}

async function main() {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const metadata = createMetadata({
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    runNumber: process.env.GITHUB_RUN_NUMBER,
    packageVersion: packageJson.version,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
