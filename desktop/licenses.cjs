const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

module.exports = async function collectLicenses() {
  const root = path.resolve(__dirname, '..');
  const project = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const visited = new Set();
  const notices = [];

  async function visit(name, parent, optional = false) {
    const resolver = createRequire(path.join(parent, 'package.json'));
    let directory;
    for (const base of resolver.resolve.paths(name) || []) {
      try { directory = await fs.realpath(path.join(base, name)); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!directory) {
      if (optional) return;
      throw new Error('Install the root dependencies before collecting desktop notices.');
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const texts = [];
    async function collect(folder, depth = 0) {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isFile() && /^(?:licen[cs]e|notice|copying|copyright)(?:[._-]|$)/i.test(entry.name)) {
          if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('A dependency notice exceeds the collection limit.');
          texts.push(`${path.relative(directory, file)}\n${await fs.readFile(file, 'utf8')}`);
        } else if (entry.isDirectory() && depth < 2 && /^(?:licen[cs]es?|notices?|cmaps|standard_fonts|wasm|iccs)$/i.test(entry.name)) {
          await collect(file, depth + 1);
        }
      }
    }
    await collect(directory);
    notices.push({
      name: `${metadata.name}@${metadata.version}`,
      text: `${metadata.name}@${metadata.version}\nDeclared license: ${JSON.stringify(metadata.license || metadata.licenses || 'Not declared')}\n\n${texts.join('\n\n') || 'No top-level license text was included in this installed package.'}`,
    });
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      await visit(dependency, directory, Object.hasOwn(metadata.optionalDependencies || {}, dependency));
    }
    for (const dependency of Object.keys(metadata.optionalDependencies || {})) await visit(dependency, directory, true);
  }

  for (const name of Object.keys(project.dependencies || {})) await visit(name, root);
  const output = path.join(__dirname, '.generated');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), [
    'Sakai Client dependency notices',
    'This inventory conservatively includes the installed renderer dependency tree, including native-only packages.',
    'Electron and Chromium license files are also distributed by electron-builder with the Electron runtime.',
    ...notices.sort((a, b) => a.name.localeCompare(b.name)).map((notice) => notice.text),
  ].join('\n\n============================================================\n\n'));
};
