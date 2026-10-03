#!/usr/bin/env node
// Detect tracked Python implementation files. Never deletes project/source data.
import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
if (result.error || result.status !== 0) {
  console.error('Run this check inside the Git repository.');
  process.exitCode = 2;
} else {
  const tracked = result.stdout.toString('utf8').split('\0').filter(Boolean);
  const runtimeDirs = new Set(['agent-core', 'ingestion', 'scripts', 'tests', 'core', 'tools', 'scrapers']);
  const isLegacy = (name) => /(?:^|\/)(?:requirements(?:-[^/]*)?\.txt|pyproject\.toml|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|setup\.(?:py|cfg)|tox\.ini|pytest\.ini|\.python-version)$/i.test(name)
    || /\.(?:py|pyi|ipynb)$/i.test(name);
  // Knowledge-base contents may legitimately include Python as source material;
  // this check is about the implementation language, not indexed languages.
  const legacy = tracked.filter((name) => {
    if (name.startsWith('ingestion/knowledge_base/')) return false;
    const first = name.split('/')[0];
    return (runtimeDirs.has(first) || !name.includes('/')) && isLegacy(name);
  });
  if (legacy.length) {
    console.error('Tracked Python implementation artifacts remain:');
    for (const name of legacy) console.error(`  ${name}`);
    console.error('Port any remaining behavior to Node before removing these files with git rm.');
    process.exitCode = 1;
  } else {
    console.log('PASS: no tracked Python implementation artifacts found.');
  }
}
