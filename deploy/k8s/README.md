# Local Kubernetes development

Day 10: add the same random `DISPATCH_ORDER_TOKEN` (at least 32 characters) to `drivers-secrets` and `orders-secrets`. Build/load the updated driver/order images and apply the manifests, including deployment/dispatch-worker. The worker uses its own service database and private HTTP APIs, with no cross-service SQL access. See docs/day-10-dispatch.md for defaults, reservation reconciliation and manual fallback. Render checks do not constitute a deployed Kubernetes environment.

Day 9: build/load `food-delivery-drivers:dev` from `apps/drivers`, rebuild the gateway and create a separate `drivers-secrets` Secret with `POSTGRES_PASSWORD`, `DRIVERS_DATABASE_URL` and a random `DRIVER_SERVICE_TOKEN` of at least 32 characters. The database URL uses user `drivers`, host `drivers-db:5432`, database `drivers_development` and the matching password. Never commit real secrets. Wait for statefulset/drivers-db and deployment/drivers. Driver config defaults to 60-second location freshness and 900-second retention. See docs/day-09-drivers.md for the foreground-only pilot and launch blockers.

Day 4: also build/load `food-delivery-restaurants:dev` from apps/restaurants and create a separate restaurants-secrets Secret containing POSTGRES_PASSWORD, RESTAURANT_DATABASE_URL, RESTAURANT_SERVICE_TOKEN, MENU_S3_ACCESS_KEY and MENU_S3_SECRET_KEY. Its database URL uses user restaurants, host restaurant-database:5432 and database restaurants_development. Wait for restaurants-migrate-day4, deployment/restaurants and statefulset/object-storage as well as the identity resources. The private storage pod creates the menu-photos bucket and persists /data. See docs/day-04-menu-management.md. Do not reuse identity database credentials.

These manifests are a local development foundation, not a production deployment. Kustomize rendering is verified; no cluster has been started or modified.

Prerequisites: a local Kubernetes cluster, working Docker engine, kubectl, default storage class, and a network plugin that enforces NetworkPolicy.

1. Build the images from the project root:

```text
docker build -t food-delivery-identity:dev apps/api
docker build -t food-delivery-gateway:dev -f apps/gateway/Dockerfile .
docker build -t food-delivery-restaurants:dev apps/restaurants
```

2. Load all three application images into your cluster using its documented image-loading command (for example `kind load docker-image ...` for kind). The cluster must also be able to pull the SeaweedFS development image.
3. Create namespace `food-delivery-dev`. Create Secret `identity-secrets` in that namespace containing `POSTGRES_PASSWORD`, `DATABASE_URL` and `BETTER_AUTH_SECRET`. The URL must point to `database:5432/food_development` with user `food` and the same PostgreSQL password. Prefer `kubectl create secret generic identity-secrets --from-env-file=<your-private-env-file> -n food-delivery-dev`. Keep that file outside source control. No actual secrets are included in these manifests.
4. Edit BETTER_AUTH_URL in kustomization.yaml to match the mobile client's reachable URL, then run `kubectl apply -k deploy/k8s`.
5. Wait for the database pod and `job/identity-migrate-day2`, then for `deployment/identity` and `deployment/gateway`. Readiness remains false until migrations and environment identity initialization succeed.
6. Run `kubectl -n food-delivery-dev port-forward service/gateway 8080:8080` and `kubectl -n food-delivery-dev port-forward service/mailpit 8025:8025` in separate terminals. Check `/health/ready` on port 8080 and open the development inbox on port 8025.

Use a new migration Job name for later releases; do not assume an already-completed Job reruns on apply. Kustomize gives configuration hashes to roll out changed configuration. Stateful storage survives pod restarts. Do not delete the namespace or PVCs when preserving development data.

The development image tags intentionally use a Node major, PostgreSQL major, Nginx stable channel and Mailpit latest; production must pin verified immutable image digests. No Ingress, public load balancer, domain, TLS certificate, production SMTP, cloud resources or app-store configuration is included.

Validation: `kubectl kustomize deploy/k8s`. This checks manifest assembly, not server-side API validation or runtime networking.

Day 11: add a stable random DELIVERY_PIN_KEY (32+ characters) and the matching DRIVER_SERVICE_TOKEN from drivers-secrets to orders-secrets. Preserve the PIN secret while deliveries are active. Build/load order, driver and gateway images, apply manifests and check readiness. See docs/day-11-delivery.md for migration, reconciliation and support policy.
