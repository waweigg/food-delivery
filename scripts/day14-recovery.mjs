import {closeSync, createReadStream, mkdirSync, openSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {databases, docker, local, requireLocalStack, run} from './day14-local.mjs';

requireLocalStack();
const id = randomUUID();
const folder = join('.local', 'day14', id);
mkdirSync(folder, {recursive:true});
const restore = 'waweigg-restore-' + id;
const app = 'waweigg-payment-drill-' + id;
const previousTag = 'waweigg-payment-previous:' + id;
const currentTag = 'waweigg-payment-candidate:' + id;
const evidence = {startedAt:new Date().toISOString(), databases:{}, rollback:[]};
const paymentSecret = randomUUID() + randomUUID();
const restoreQuery = (database, query) => docker(['exec','-i',restore,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database], {input:query});

async function ready(description, probe) {
  for (let tries = 0; tries < 40; tries++) {
    if (probe() !== null) return;
    await delay(1000);
  }
  throw new Error(description + ' did not become ready');
}

async function paymentStage(stage, image) {
  docker(['rm','-f',app], {allowFailure:true});
  docker(['run','-d','--name',app,'--network','container:'+restore,
    '-e','APP_ENV=development','-e','PAYMENT_PROVIDER=local-test',
    '-e','PAYMENTS_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/payments_development',
    '-e','PAYMENTS_ORDER_TOKEN='+paymentSecret,'-e','PAYMENTS_WEBHOOK_SECRET='+paymentSecret,
    '-e','ORDERS_URL=http://127.0.0.1:1','-e','IDENTITY_URL=http://127.0.0.1:1',image]);
  await ready(stage, () => docker(['exec',app,'node','-e',
    "fetch('http://127.0.0.1:3003/health',{signal:AbortSignal.timeout(2000)}).then(async r=>process.exit(r.ok&&(await r.json()).ok?0:1)).catch(()=>process.exit(1))"], {allowFailure:true}));
  const facts = restoreQuery('payments_development', `
    SELECT concat_ws(':',(SELECT count(*) FROM attempts),(SELECT count(*) FROM refunds),
      (SELECT count(*) FROM ledger_entries),(SELECT count(*) FROM settlements),
      (SELECT count(*) FROM settlement_journal),(SELECT count(*) FROM test_payouts),
      (SELECT count(*) FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount)<>0) unbalanced));
  `);
  if (!facts.endsWith(':0')) throw new Error('Payment journals failed balance verification');
  evidence.rollback.push({stage, image:docker(['image','inspect','--format','{{.Id}}',image]), paymentFacts:facts.split(':').map(Number)});
}

try {
  for (const [service,[user,database]] of Object.entries(databases)) {
    const dump = join(folder, database + '.dump');
    const fd = openSync(dump,'wx');
    try {
      local(['exec','-T',service,'pg_dump','-Fc','--no-owner','--no-acl','-U',user,'-d',database], {output:fd});
    } finally { closeSync(fd); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(dump)) hash.update(chunk);
    evidence.databases[database] = {sha256:hash.digest('hex')};
  }
  const sourceDb = local(['ps','-q','payments-db']);
  const postgresImage = docker(['inspect','--format','{{.Image}}',sourceDb]);
  docker(['run','-d','--name',restore,'--network','none','--tmpfs','/var/lib/postgresql/data',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust',postgresImage]);
  await ready('Isolated PostgreSQL', () => docker(['exec',restore,'pg_isready','-h','127.0.0.1','-U','postgres'], {allowFailure:true}));
  for (const [,database] of Object.values(databases)) {
    docker(['exec',restore,'createdb','-U','postgres',database]);
    const fd = openSync(join(folder,database+'.dump'),'r');
    try {
      docker(['exec','-i',restore,'pg_restore','-U','postgres','--exit-on-error','--no-owner','--no-acl','-d',database], {stdin:fd});
    } finally { closeSync(fd); }
    const restored = Number(restoreQuery(database,"SELECT count(*) FROM pg_tables WHERE schemaname='public';"));
    if (!restored) throw new Error('No public tables restored for '+database);
    evidence.databases[database].restoredTables = restored;
    console.log(database, 'restored tables', restored);
  }

  const baseline = run('git',['rev-parse','HEAD']);
  evidence.previousRevision = baseline;
  const previous = join(folder,'previous-payments');
  mkdirSync(previous);
  // The payment build context consists of checked-in text sources.
  for (const path of run('git',['ls-tree','-r','--name-only',baseline,'apps/payments']).split(/\r?\n/)) {
    writeFileSync(join(previous,path.slice('apps/payments/'.length)),run('git',['show',baseline+':'+path])+'\n');
  }
  docker(['build','-t',previousTag,previous]);
  docker(['build','-t',currentTag,'apps/payments']);
  await paymentStage('previous',previousTag);
  await paymentStage('candidate',currentTag);
  await paymentStage('rolled back',previousTag);
  const expected = JSON.stringify(evidence.rollback[0].paymentFacts);
  if (evidence.rollback.some(({paymentFacts}) => JSON.stringify(paymentFacts) !== expected)) {
    throw new Error('Payment data changed during the release drill');
  }
  evidence.passed = true;
  console.log('PASS: previous image -> candidate -> previous image, with the same restored database and balanced ledger');
} finally {
  docker(['rm','-f',app], {allowFailure:true});
  docker(['rm','-fv',restore], {allowFailure:true});
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(folder,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('Local evidence:', join(folder,'evidence.json'));
}
