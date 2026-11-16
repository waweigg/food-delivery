import {setTimeout as delay} from 'node:timers/promises';
import {local, sql, requireLocalStack} from './day14-local.mjs';

const test = process.argv.includes('--test-alert');
const watch = process.argv.includes('--watch');
const services = ['gateway','identity','restaurants','orders','payments','drivers','identity-worker','orders-worker','dispatch-worker','object-storage'];
const uptime = [['gateway',8080,'/gateway-health'],['identity',3000,'/health/ready'],['restaurants',3001,'/restaurants-health/ready'],['orders',3002,'/orders-health'],['payments',3003,'/health'],['drivers',3004,'/drivers-health']];
const gatewayPaths = ['/health/ready','/restaurants-health/ready','/drivers-health','/catalog/restaurants'];
const errorSignals = [
  ['identity-worker','Worker database unavailable'],
  ['orders-worker','Order worker temporarily unavailable'],
  ['dispatch-worker','Dispatch cycle unavailable; will retry'],
  ['payments','Payment sweep deferred'],
];
const checks = [
  ['PAYMENT_FAILURES','payments-db',"SELECT count(*) FROM attempts WHERE status='FAILED' AND created_at > now()-interval '15 minutes'"],
  ['REFUND_FAILURES','payments-db',"SELECT count(*) FROM refunds WHERE status='FAILED' OR (status='PENDING' AND created_at < now()-interval '5 minutes')"],
  ['PAYMENT_SYNC_STALLED','payments-db',"SELECT count(*) FROM attempts WHERE NOT synchronized AND created_at < now()-interval '5 minutes'"],
  ['KITCHEN_STALLED','orders-db',"SELECT count(*) FROM kitchen_tickets WHERE (state='NEW' AND deadline < now()) OR (state IN ('ACCEPTED','PREPARING') AND updated_at < now()-interval '45 minutes')"],
  ['ORDER_PAYMENT_RECOVERY','orders-db',"SELECT count(*) FROM payment_recovery WHERE status IN ('REFUND_PENDING','REVIEW_REQUIRED') AND created_at < now()-interval '5 minutes'"],
  ['ORDER_WORKER_BACKLOG','orders-db',"SELECT count(*) FROM outbox WHERE processed_at IS NULL AND (attempts > 2 OR next_attempt < now()-interval '2 minutes')"],
  ['DISPATCH_NEEDS_ATTENTION','drivers-db',"SELECT count(*) FROM dispatch_jobs WHERE state='NEEDS_ATTENTION' OR (state='SEARCHING' AND created_at < now()-interval '2 minutes' AND issue LIKE 'No eligible nearby driver%')"],
  ['DELIVERY_NEEDS_ATTENTION','drivers-db',"SELECT count(*) FROM dispatch_jobs WHERE state IN ('ASSIGNED','PICKED_UP') AND issue IS NOT NULL"],
];

async function sendAlert(alerts, subject) {
  const receiptId = crypto.randomUUID();
  const snippet = `
    import nodemailer from 'nodemailer';
    const parts = [];
    for await (const part of process.stdin) parts.push(part);
    const {receiptId, subject, alerts} = JSON.parse(Buffer.concat(parts));
    const smtp = nodemailer.createTransport('smtp://mailpit:1025');
    await smtp.sendMail({from:'operations@waweigg.test',to:'local-ops@waweigg.test',subject:subject+' '+receiptId,text:JSON.stringify(alerts,null,2)});
  `;
  local(['exec','-T','identity','node','--input-type=module','-e',snippet], {input:JSON.stringify({receiptId,subject,alerts})});
  console.log(JSON.stringify({mailpitReceipt:receiptId}));
}

requireLocalStack();
if (test) await sendAlert([{code:'DAY14_TEST_ALERT',count:1}], 'waweigg local drill');
else {
  const sent = new Map();
  do {
    const alerts = [];
    const states = local(['ps','-a','--format','{{.Service}} {{.State}} {{.Health}}']);
    const running = new Set(states.split('\n').filter(line => / running (healthy)?\s*$/.test(line)).map(line => line.split(' ')[0]));
    for (const service of services) {
      if (!running.has(service)) alerts.push({code:'SERVICE_DOWN',service,count:1});
    }
    for (const [service,port,path] of [...uptime,...gatewayPaths.map(path => ['gateway',8080,path])]) {
      const result = local(['exec','-T','gateway','wget','-T','5','-q','-O','/dev/null',`http://${service}:${port}${path}`], {allowFailure:true});
      if (result === null) alerts.push({code:'UPTIME_PROBE_FAILED',service,check:path,count:1});
    }
    for (const [service,signal] of errorSignals) {
      // Count known errors without copying raw logs or request data into alerts.
      const logs = local(['logs','--no-color','--since','2m','--tail','200',service], {allowFailure:true,combineStderr:true});
      if (logs === null) {
        alerts.push({code:'MONITOR_LOG_READ_FAILED',service,count:1});
        continue;
      }
      const count = logs.split('\n').filter(line => line.includes(signal)).length;
      if (count) alerts.push({code:'SERVICE_ERRORS',service,count});
    }
    for (const [code,service,query] of checks) {
      try {
        const count = sql(service,query);
        if (count) alerts.push({code,service,count});
      } catch {
        alerts.push({code:'MONITOR_QUERY_FAILED',service,check:code,count:1});
      }
    }
    console.log(JSON.stringify({at:new Date().toISOString(),alerts}));
    const active = new Set(alerts.map(({code,service,check}) => [code,service,check].join('/')));
    for (const key of sent.keys()) if (!active.has(key)) sent.delete(key);
    const fresh = alerts.filter(({code,service,check}) => Date.now() - (sent.get([code,service,check].join('/')) ?? 0) >= 900_000);
    if (fresh.length) {
      try {
        await sendAlert(fresh, 'waweigg local operations alert');
        for (const {code,service,check} of fresh) sent.set([code,service,check].join('/'), Date.now());
      } catch (error) {
        console.error('Local alert delivery failed:', error.message);
        if (!watch) process.exitCode = 2;
      }
    }
    if (!watch && alerts.length && !process.exitCode) process.exitCode = 1;
    if (watch) await delay(60_000);
  } while (watch);
}
