import {spawnSync} from 'node:child_process';

export const compose = ['compose', '-f', 'compose.yaml', '-f', 'compose.services.yaml'];
export const databases = {
  database: ['food', 'food_development'],
  'restaurant-database': ['restaurants', 'restaurants_development'],
  'orders-db': ['orders', 'orders_development'],
  'payments-db': ['payments', 'payments_development'],
  'drivers-db': ['drivers', 'drivers_development'],
};

export function run(program, args, {input, output, stdin, allowFailure = false, combineStderr = false} = {}) {
  const result = spawnSync(program, args, {
    input, encoding: 'utf8', timeout: 120_000,
    stdio: [stdin ?? 'pipe', output ?? 'pipe', 'pipe'],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${program} ${args[0]} failed (exit ${result.status ?? result.error?.code ?? 'unknown'})`);
  }
  if (result.status !== 0) return null;
  return combineStderr ? [result.stdout, result.stderr].join('\n').trim() : result.stdout?.trim();
}

export const docker = (args, options) => run('docker', args, options);
export const local = (args, options) => docker([...compose, ...args], options);
export function sql(service, query) {
  const [user, database] = databases[service];
  return Number(local(['exec', '-T', service, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database], {input: query}));
}

export function requireLocalStack() {
  if (!local(['ps', '-q', 'gateway'])) throw new Error('Start the local Compose stack first');
}
