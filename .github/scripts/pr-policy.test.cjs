const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('./pr-policy.cjs');

function event(base, head, headRepo = 1438363152, headName = 'IlyaGubanov/Dashboard_v_0.2') {
  const repo = { id: 1438363152, full_name: 'IlyaGubanov/Dashboard_v_0.2' };
  return { repository: repo, pull_request: { base: { ref: base, repo }, head: { ref: head, repo: { id: headRepo, full_name: headName } } } };
}

// Catches accepting arbitrary refs, fork branches with trusted names, or incomplete payloads.
for (const [name, input, allowed] of [
  ['developer to dev', event('dev', 'mvsst-1'), true],
  ['multi-digit developer to dev', event('dev', 'mvsst-123'), true],
  ['release from same repository', event('main', 'dev'), true],
  ['developer cannot release', event('main', 'mvsst-1'), false],
  ['legacy branch cannot release', event('main', 'fix/a'), false],
  ['legacy branch cannot integrate', event('dev', 'feature/a'), false],
  ['main cannot integrate directly', event('dev', 'main'), false],
  ['zero is not a developer number', event('dev', 'mvsst-0'), false],
  ['leading zero is not a developer number', event('dev', 'mvsst-01'), false],
  ['suffix is not a developer number', event('dev', 'mvsst-1-extra'), false],
  ['fork dev cannot release', event('main', 'dev', 999, 'other/Dashboard_v_0.2'), false],
  ['fork developer cannot integrate', event('dev', 'mvsst-1', 999), false],
  ['spoofed name cannot release', event('main', 'dev', 1438363152, 'other/repo'), false],
  ['unsupported target fails closed', event('other', 'mvsst-1'), false],
  ['missing payload fails closed', {}, false],
  ['missing head repository fails closed', { ...event('main', 'dev'), pull_request: { base: event('main', 'dev').pull_request.base, head: { ref: 'dev', repo: null } } }, false],
  ['other base repository fails closed', { ...event('main', 'dev'), repository: { id: 999, full_name: 'other/repo' } }, false],
]) {
  test(name, () => assert.equal(validate(input).allowed, allowed));
}
