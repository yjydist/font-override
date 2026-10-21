import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from '../package.json';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface BuildOptions {
  outdir?: string;
  repository?: string;
  releaseTag?: string;
}

function metadata(repository?: string): string {
  const fields: [string, string][] = [
    ['name', '智能字体替换'],
    ['namespace', 'font-override'],
    ['version', version],
    ['description', '按 sans、serif、mono 分类，在原字体栈前插入自选字体，保护图标、公式和已知加密字体。'],
    ['match', 'http://*/*'],
    ['match', 'https://*/*'],
    ['run-at', 'document-end'],
    ['grant', 'GM_getValue'],
    ['grant', 'GM_setValue'],
    ['grant', 'GM_registerMenuCommand'],
    ['grant', 'GM_addValueChangeListener'],
  ];

  if (repository) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error('GITHUB_REPOSITORY must be an owner/repository pair.');
    }
    const latest = `https://github.com/${repository}/releases/latest/download`;
    fields.push(
      ['updateURL', `${latest}/font-override.meta.js`],
      ['downloadURL', `${latest}/font-override.user.js`],
    );
  }

  return [
    '// ==UserScript==',
    ...fields.map(([key, value]) => `// @${key.padEnd(13)}${value}`),
    '// ==/UserScript==',
    '',
  ].join('\n');
}

export async function buildUserscript({
  outdir = join(projectRoot, 'dist'),
  repository,
  releaseTag,
}: BuildOptions = {}) {
  if (!stableVersion.test(version)) {
    throw new Error('package.json version must be a stable X.Y.Z version.');
  }
  if (releaseTag !== undefined) {
    if (releaseTag !== `v${version}`) {
      throw new Error(`Release tag ${releaseTag} must match package.json version v${version}.`);
    }
    if (!repository) throw new Error('A release build requires GITHUB_REPOSITORY.');
  }

  const header = metadata(repository);
  // Build in memory first: validation or bundling failures must not produce a release.
  const result = await Bun.build({
    entrypoints: [join(projectRoot, 'src/index.ts')],
    target: 'browser',
    format: 'iife',
    minify: false,
    splitting: false,
    sourcemap: 'none',
    banner: `${header}\n'use strict';`,
  });
  if (!result.success) throw new AggregateError(result.logs, 'Userscript build failed.');
  if (result.outputs.length !== 1 || result.outputs[0].kind !== 'entry-point') {
    throw new Error('The userscript must be a single JavaScript bundle.');
  }

  const scriptPath = join(outdir, 'font-override.user.js');
  const metadataPath = join(outdir, 'font-override.meta.js');
  await mkdir(outdir, { recursive: true });
  await Bun.write(scriptPath, result.outputs[0]);
  await Bun.write(metadataPath, header);
  return { scriptPath, metadataPath };
}

if (import.meta.main) {
  const isTag = Bun.env.GITHUB_REF_TYPE === 'tag';
  if (isTag && !Bun.env.GITHUB_REF_NAME) throw new Error('Missing GITHUB_REF_NAME for tag build.');
  const artifacts = await buildUserscript({
    repository: Bun.env.GITHUB_REPOSITORY,
    releaseTag: isTag ? Bun.env.GITHUB_REF_NAME : undefined,
  });
  console.log(`Built ${artifacts.scriptPath}\nBuilt ${artifacts.metadataPath}`);
}
