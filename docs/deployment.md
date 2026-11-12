# Private staging and production deployment

Day 2 update: hosting and production are explicitly deferred by the user. The current architecture is described in architecture.md; local microservice deployment uses compose.services.yaml or deploy/k8s. Instructions below describe future hosted setup. Add BETTER_AUTH_URL (HTTPS), BETTER_AUTH_SECRET, SMTP_URL and MAIL_FROM through the secret/configuration provider; the identity service rejects staging/production startup without these settings.

Hosting provider, region, credentials, domain and budget are not provided. No environment has been deployed.

1. Provision separate managed PostgreSQL instances and separate service identities for staging and production. Restrict each database firewall to its own services; never share database credentials. Enable provider backups and secret management.
2. Build apps/api/Dockerfile from apps/api as context. Run a web service using its default command, and a worker from the same image using `npm run worker`.
3. Set APP_ENV to staging or production, DATABASE_URL through the provider secret store, and PORT according to the hosting platform. Configure HTTPS and private network/VPN or an access gateway that permits pilot devices. Maintenance mode alone does not make a URL private.
4. Run `npm run migrate` as a one-off release job. Run `node scripts/init-database.cjs` from a checkout with environment credentials to initialize the database identity. The script refuses to overwrite an existing environment identity.
5. Verify HTTPS /health/live and /health/ready from an authorized device. Verify the wrong environment fails readiness, and verify actual database network access is denied between environments. The identity check supplements infrastructure isolation; it does not replace firewall rules.
6. Start the worker. Verify logs contain no credentials. Ordering has no routes and /config always reports maintenance=true and orderingEnabled=false.
7. Record deployment URL, image digest, migration status and health-check evidence in progress.md. Configure alerts on readiness failures and process exits.

Rollback: redeploy the previous verified image; review schema compatibility first. Do not automatically reverse database migrations. Use managed database recovery for data incidents and rehearse restoration before public launch.

CI configuration is provided but has not run remotely. Native CI builds are debug/simulator checks, not signed store releases. iOS distribution needs macOS/Xcode and an Apple Developer account; Android release needs an owned signing key and distribution setup.

External dependency tracker: hosting/domain owner TBD (access pending); payment merchant owner TBD (country/provider pending); restaurant onboarding owner TBD; driver onboarding owner TBD. No external applications or messages have been submitted.
