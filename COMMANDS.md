# Forson Business Suite - Commands

Simple, copy-paste-ready commands for development and production. Descriptions are outside the code blocks. Commands include sudo where appropriate.

## 🚨 DEVELOPER RULES (CRITICAL)
1. **SCHEMA CHANGES:** Never edit or add tables to `initial_schema.sql` without also creating a corresponding `.sql` script in `database/migrations/`.
2. **PRODUCTION UPDATES:** Always run the migration loop after a deploy to ensure the live database matches the codebase. The migration loop is the *only* approved method for applying schema changes safely without losing data.
3. **LOGS FIRST:** If a 500 error occurs in production, immediately check the logs using `sudo docker compose -f docker-compose.prod.yml logs -f backend` to see the exact root cause.
---

## 1) One-Time Setup

Create a working .env from the example file.
```bash
cp .env.example .env
```

---

## 2) Development

Start dev stack with hot reload.
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Initialize the database (first run only).
```bash
docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
```

Apply migrations.
```bash
npm --prefix packages/api run migrate -- --host localhost
```

Open logs for backend.
```bash
docker compose logs -f backend
```

Stop and remove dev containers.
```bash
docker compose down
```

---

## 3) Production

Start or update the production stack.
```bash
sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans
```

Initialize the database (first run only).
```bash
sudo docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
sudo docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
```

Apply migrations (Docker-only, no host Node/npm required).
```bash
for f in $(ls database/migrations/*.sql | sort); do cat "$f" | sudo docker exec -i forson_db psql -U postgres -d forson_business_suite; done
```

Check service status.
```bash
sudo docker compose -f docker-compose.prod.yml ps
```

Tail backend logs.
```bash
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

Stop and remove production containers.
```bash
sudo docker compose -f docker-compose.prod.yml down
```

---

## 4) Update/Upgrade (Production)

Deploying by release tags ensures the production server runs an exact, validated snapshot of the codebase. 

Back up the database.
```bash
mkdir -p backups
ts=$(date +"%Y-%m-%dT%H-%M-%S")
sudo docker exec -t forson_db pg_dump -U postgres forson_business_suite > backups/backup-$ts.sql
echo "Backup saved: backups/backup-$ts.sql"
```

Fetch the newest release tags and check out the latest version (e.g., v1.4.2).
```bash
git fetch --tags --force
LATEST_TAG=$(git tag -l --sort=-v:refname | head -n 1)
echo "Checking out latest release: $LATEST_TAG"
git checkout $LATEST_TAG
```

Redeploy the stack with the newly checked-out code.
```bash
sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans
```

Run the mandatory migration loop to self-heal and update the schema.
```bash
echo "Running database migrations..."
for f in $(ls database/migrations/*.sql | sort); do cat "$f" | sudo docker exec -i forson_db psql -U postgres -d forson_business_suite; done
```

Smoke test backend.
```bash
curl -s http://localhost:3001/api/setup/status || true
echo -e "\nUpdate complete!"
```

---

## 5) Useful Admin

List containers.
```bash
sudo docker ps
```

Inspect a service's logs.
```bash
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

Open a shell in the backend container.
```bash
sudo docker exec -it forson_backend sh
```

Open a psql session in the db container.
```bash
sudo docker exec -it forson_db psql -U postgres -d forson_business_suite
```