# Forson Business Suite - Commands

Simple, copy-paste-ready commands for development and production. Descriptions are outside the code blocks. Commands include sudo where appropriate.

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

Apply migrations.
```bash
npm --prefix packages/api run migrate -- --host 127.0.0.1
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

Back up the database.
```bash
mkdir -p backups
ts=$(date +"%Y-%m-%dT%H-%M-%S")
sudo docker exec -t forson_db pg_dump -U postgres forson_business_suite > backups/backup-$ts.sql
```

Pull latest code.
```bash
git pull --ff-only
```

Redeploy the stack.
```bash
sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans
```

Run migrations.
```bash
npm --prefix packages/api run migrate -- --host 127.0.0.1
```

Smoke test backend.
```bash
curl -s http://localhost:3001/api/setup/status || true
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