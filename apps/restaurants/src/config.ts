export function config() {
  const environment=process.env.APP_ENV ?? 'development';
  const databaseUrl=process.env.RESTAURANT_DATABASE_URL;
  const identityUrl=process.env.IDENTITY_URL;
  const serviceToken=process.env.RESTAURANT_SERVICE_TOKEN;
  const port=Number(process.env.PORT ?? 3001);
  if(!['development','test','staging','production'].includes(environment) || !databaseUrl || !identityUrl || !serviceToken || serviceToken.length<32 || !Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid restaurant service configuration');
  const url=new URL(identityUrl);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid IDENTITY_URL');
  return {environment,databaseUrl,identityUrl:url.origin,serviceToken,port};
}
