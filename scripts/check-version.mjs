import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { version } = readJson('../package.json');
const lock = readJson('../package-lock.json');
const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (
  typeof version !== 'string' ||
  !releaseVersion.test(version) ||
  lock.version !== version ||
  lock.packages?.['']?.version !== version
) {
  console.error('Use a MAJOR.MINOR.PATCH version in package.json and both root lockfile fields.');
  process.exitCode = 1;
}
