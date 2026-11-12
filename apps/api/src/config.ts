export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.APP_ENV ?? 'development';
  if (!['development','test','staging','production'].includes(environment)) throw new Error('Invalid APP_ENV');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {environment, port, databaseUrl:env.DATABASE_URL};
}
