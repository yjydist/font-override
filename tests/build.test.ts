import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { version } from '../package.json';
import { buildUserscript } from '../scripts/build';

let temporaryRoot: string;
beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'font-override-build-'));
});
afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

test('local build is a standalone classic script with a metadata-only companion', async () => {
  const outdir = join(temporaryRoot, 'local');
  const { scriptPath, metadataPath } = await buildUserscript({ outdir });
  const script = await Bun.file(scriptPath).text();
  const header = await Bun.file(metadataPath).text();

  expect((await readdir(outdir)).sort()).toEqual(['font-override.meta.js', 'font-override.user.js']);
  expect(script.startsWith(header)).toBe(true);
  expect(header.startsWith('// ==UserScript==\n')).toBe(true);
  expect(header.endsWith('// ==/UserScript==\n')).toBe(true);
  expect(header.trim().split('\n').every(line => line.startsWith('//'))).toBe(true);
  expect(header).toMatch(new RegExp(`^// @version\\s+${version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  expect(header).toMatch(/^\/\/ @name\s+智能字体替换$/m);
  expect(header).toMatch(/^\/\/ @namespace\s+font-override$/m);
  expect(header).not.toContain('@updateURL');
  expect(header).not.toContain('@downloadURL');
  expect(script.match(/==UserScript==/g)).toHaveLength(1);
  expect(script).toMatch(/\(\(\) => \{/);
  expect(script).not.toMatch(/\b(?:Bun\.|process\.|require\s*\(|import\.meta|sourceMappingURL)/);
  expect(new Bun.Transpiler({ loader: 'js' }).scan(script).imports).toEqual([]);
  expect(() => new Function(script)).not.toThrow();
});

test('release metadata uses the same version and stable URLs in both artifacts', async () => {
  const { scriptPath, metadataPath } = await buildUserscript({
    outdir: join(temporaryRoot, 'release'),
    repository: 'example/font-override',
    releaseTag: `v${version}`,
  });
  const header = await Bun.file(metadataPath).text();
  expect((await Bun.file(scriptPath).text()).startsWith(header)).toBe(true);
  expect(header).toMatch(/^\/\/ @updateURL\s+https:\/\/github\.com\/example\/font-override\/releases\/latest\/download\/font-override\.meta\.js$/m);
  expect(header).toMatch(/^\/\/ @downloadURL\s+https:\/\/github\.com\/example\/font-override\/releases\/latest\/download\/font-override\.user\.js$/m);
});

test.each(['v999.0.0', version, `v${version}-beta.1`])('rejects mismatched or unsupported release tag %s before writing', async releaseTag => {
  const outdir = join(temporaryRoot, `invalid-${releaseTag}`);
  await expect(buildUserscript({ outdir, repository: 'example/font-override', releaseTag })).rejects.toThrow('must match');
  expect(await Bun.file(join(outdir, 'font-override.user.js')).exists()).toBe(false);
});

test('rejects a release without a repository and invalid repository metadata', async () => {
  await expect(buildUserscript({ outdir: join(temporaryRoot, 'missing'), releaseTag: `v${version}` })).rejects.toThrow('requires GITHUB_REPOSITORY');
  await expect(buildUserscript({ outdir: join(temporaryRoot, 'injection'), repository: 'owner/repo\n// @require bad' })).rejects.toThrow('owner/repository');
});
