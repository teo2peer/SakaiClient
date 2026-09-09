const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const homepage = args.find((arg) => arg.startsWith('--homepage='))?.slice('--homepage='.length);
const version = process.env.BUILD_VERSION;
const buildNumber = process.env.BUILD_NUMBER;
let validHomepage = homepage === undefined;
if (homepage !== undefined) {
  try {
    const url = new URL(homepage);
    validHomepage = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { validHomepage = false; }
}
if (version !== undefined && (version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version))) {
  process.stderr.write('BUILD_VERSION must be a valid semantic version.\n');
  process.exitCode = 1;
} else if (buildNumber !== undefined && (!/^[1-9]\d*$/.test(buildNumber) || Number(buildNumber) > 65535)) {
  process.stderr.write('Desktop BUILD_NUMBER must be a canonical integer between 1 and 65535.\n');
  process.exitCode = 1;
} else if (!validHomepage || args.some((arg) => !arg.startsWith('--homepage=') &&
    !['--dir', '--win', '--mac', '--linux', '--appimage', '--x64', '--arm64', '--universal'].includes(arg))) {
  process.stderr.write('Allowed options: --dir --win --mac --linux --appimage --x64 --arm64 --universal --homepage=<real-project-https-url>\n');
  process.exitCode = 1;
} else {
  // Pin the packaged runtime to the root installation without duplicating Electron dependencies here.
  const result = spawnSync(process.execPath, [
    require.resolve('electron-builder/cli.js'),
    '--projectDir', __dirname,
    '--config', path.join(__dirname, 'electron-builder.yml'),
    `--config.electronVersion=${require('electron/package.json').version}`,
    ...args.filter((arg) => !arg.startsWith('--homepage=')).flatMap((arg) => arg === '--appimage' ? ['--linux', 'AppImage'] : [arg]),
    ...(homepage ? [`--config.extraMetadata.homepage=${homepage}`] : []),
    ...(version ? [`--config.extraMetadata.version=${version}`] : []),
    ...(version ? [`--config.mac.bundleShortVersion=${version.split('-')[0]}`] : []),
    ...(buildNumber || version ? [`--config.buildVersion=${buildNumber ?? version.split('-')[0]}`] : []),
    '--publish', 'never',
  ], { cwd: __dirname, stdio: 'inherit' });
  if (result.error) process.stderr.write('The desktop packager could not be started.\n');
  process.exitCode = result.status ?? 1;
}
