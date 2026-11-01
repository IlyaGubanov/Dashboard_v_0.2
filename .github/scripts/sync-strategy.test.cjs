const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

test('three merge releases and PR-based sync preserve dev changes and ancestry', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mvs-git-sync-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Git workflow test');
  git('config', 'user.email', 'workflow@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('commit', '--allow-empty', '-m', 'production baseline');
  git('branch', 'dev');
  let number = 0;
  for (let release = 1; release <= 3; release++) {
    git('switch', '-c', `mvsst-${++number}`, 'dev');
    writeFileSync(join(cwd, `release-${release}.txt`), `release ${release}\n`);
    git('add', '.');
    git('commit', '-m', `task ${release}`);
    git('switch', 'dev');
    git('merge', '--no-ff', `mvsst-${number}`, '-m', 'developer PR');
    git('switch', 'main');
    git('merge', '--no-ff', 'dev', '-m', 'owner-approved release PR');
    assert.equal(git('diff', 'main', 'dev'), '');
    const released = git('rev-parse', 'main');
    // Simulate continued integration while release history is being synchronized.
    if (release === 2) {
      git('switch', '-c', `mvsst-${++number}`, 'dev');
      writeFileSync(join(cwd, 'next-task.txt'), 'must survive sync\n');
      git('add', '.');
      git('commit', '-m', 'parallel task');
      git('switch', 'dev');
      git('merge', '--no-ff', `mvsst-${number}`, '-m', 'parallel PR');
    }
    const before = git('rev-parse', 'dev^{tree}');
    git('switch', '-c', `mvsst-${++number}`, 'dev');
    git('merge', '--no-edit', 'main');
    assert.equal(git('rev-parse', 'HEAD^{tree}'), before, 'sync must preserve current dev content');
    git('switch', 'dev');
    git('merge', '--no-ff', `mvsst-${number}`, '-m', 'sync PR');
    git('merge-base', '--is-ancestor', released, 'dev');
    assert.equal(git('rev-list', '--count', 'dev..main'), '0', 'no accumulated main-only history');
  }
});
