const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gateContext } = require('./gate-context.cjs');
const run = { event: 'pull_request', path: '.github/workflows/ob1-gate-v2.yml',
  head_sha: 'abc', head_branch: 'fix', head_repository: { id: 2 }, conclusion: 'success' };
const pr = { number: 343, state: 'open', base: { repo: { id: 1 } },
  head: { sha: 'abc', ref: 'fix', repo: { id: 2 } }, draft: false,
  user: { login: 'actual-author' }, author_association: 'NONE', title: 'Real title' };
const report = { pr_number: 343, head_sha: 'abc', failed: false, secret_blocked: false };
test('uses live author and trust, ignoring forged report identity', () => {
  const result = gateContext(run, pr, { ...report, author_association: 'OWNER',
    author_login: 'attacker', is_draft: true }, 1);
  assert.equal(result.author_association, 'NONE');
  assert.equal(result.author_login, 'actual-author');
  assert.equal(result.is_draft, false);
});
test('rejects another PR, another repository, stale head, and closed PR', () => {
  assert.throws(() => gateContext(run, pr, { ...report, pr_number: 99 }, 1));
  assert.throws(() => gateContext(run, pr, report, 999));
  assert.throws(() => gateContext(run, { ...pr, head: { ...pr.head, sha: 'new' } }, report, 1));
  assert.throws(() => gateContext(run, { ...pr, state: 'closed' }, report, 1));
  assert.throws(() => gateContext({ ...run, head_repository: { id: 999 } }, pr, report, 1));
});
test('rejects wrong workflow/event and invalid boolean fields', () => {
  assert.throws(() => gateContext({ ...run, path: 'malicious.yml' }, pr, report, 1));
  assert.throws(() => gateContext({ ...run, event: 'push' }, pr, report, 1));
  assert.throws(() => gateContext(run, pr, { ...report, failed: 'false' }, 1));
});
test('a failed run cannot become passed through its artifact', () => {
  assert.equal(gateContext({ ...run, conclusion: 'failure' }, pr, report, 1).failed, true);
});
