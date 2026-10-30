// Artifact contents are untrusted. Only live GitHub data establishes identity.
function gateContext(run, pr, report, repositoryId) {
  if (run.event !== 'pull_request' || run.path !== '.github/workflows/ob1-gate-v2.yml') {
    throw new Error('Unexpected upstream gate workflow');
  }
  if (pr.state !== 'open' || pr.base.repo.id !== repositoryId ||
      pr.head.repo?.id !== run.head_repository?.id ||
      pr.head.sha !== run.head_sha || pr.head.ref !== run.head_branch) {
    throw new Error('Gate run does not match a current open PR');
  }
  if (report.pr_number !== pr.number || report.head_sha !== pr.head.sha ||
      typeof report.failed !== 'boolean' || typeof report.secret_blocked !== 'boolean') {
    throw new Error('Gate artifact does not match the verified PR');
  }
  return {
    pr_number: pr.number,
    pr_url: pr.html_url,
    title: pr.title,
    head_sha: pr.head.sha,
    author_login: pr.user.login,
    author_association: pr.author_association,
    is_draft: pr.draft,
    failed: report.failed || run.conclusion !== 'success',
    secret_blocked: report.secret_blocked,
  };
}
module.exports = { gateContext };
