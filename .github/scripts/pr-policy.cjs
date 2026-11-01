const fs = require('node:fs');
const REPOSITORY = 'IlyaGubanov/Dashboard_v_0.2';
const REPOSITORY_ID = 1438363152;

function validate(event) {
  const pr = event?.pull_request;
  const trusted = (repo) => repo?.id === REPOSITORY_ID && repo?.full_name === REPOSITORY;
  if (!trusted(event?.repository) || !trusted(pr?.base?.repo) || !trusted(pr?.head?.repo)) {
    return { allowed: false, reason: 'PR должен происходить внутри ожидаемого репозитория (проверяются ID и полное имя).' };
  }
  const base = pr.base.ref;
  const head = pr.head.ref;
  const allowed = (base === 'main' && head === 'dev') || (base === 'dev' && /^mvsst-[1-9][0-9]*$/.test(head));
  return { allowed, reason: allowed ? 'Разрешённое направление PR.' : 'Разрешены только mvsst-N → dev и dev → main.' };
}

module.exports = { validate };
if (require.main === module) {
  try {
    if (!['pull_request', 'pull_request_target'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('Ожидается событие PR.');
    const result = validate(JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    console.log(result.reason);
    if (!result.allowed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
