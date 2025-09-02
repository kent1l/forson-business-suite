# Forson Business Suite - Command Reference

This file contains the common CLI commands needed to set up and manage the application environments.

---

## ✅ 1. One-Time Project Setup

These commands only need to be run once when you first clone the project.

1.  **Create the master environment file**.
    *(Copy the example file to create your local configuration)*.

    ```bash
    cp .env.example .env
    ```

2.  **Edit the `.env` file**.
    *(You MUST open the newly created `.env` file and replace the placeholder values with your actual secrets, especially `DB_PASSWORD` and `JWT_SECRET`)*.

---

## 🚀 2. Development Environment

Use these commands for local development. This setup provides hot-reloading for both the frontend and backend.

1.  **Build and Start All Development Containers**:

    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
    ```

2.  **Initialize the Database** (Run only the first time, after containers are running):

    ```bash
    docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql && docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
    # then apply all migrations in order (recommended, PowerShell)
    # Get-ChildItem .\database\migrations\*.sql | Sort-Object Name | ForEach-Object { docker cp $_.FullName forson_db:/m.sql; docker exec -u postgres forson_db psql -d forson_business_suite -f /m.sql }
    ```

> **Access URLs**:
> * Frontend: `http://localhost:5173`
> * Backend API: `http://localhost:3001`

---

## 🏭 3. Production Environment

Use these commands to simulate the production environment locally. This uses the pre-built Docker images.

1.  **Build and Start All Production Containers**:

    ```bash
    docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans
    ```

2.  **Initialize the Database** (Run only the first time, after containers are running):

    ```bash
    docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql && docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
    # then apply all migrations in order (Linux/bash)
    for f in $(ls database/migrations/*.sql | sort); do echo "Applying $f" && cat "$f" | docker compose exec -T db psql -U postgres -d forson_business_suite; done
    ```

> **Access URLs**:
> * Frontend: `http://localhost:8090`
> * Backend API: `http://localhost:3001`

---

## 🛠️ 4. Common Management Commands

1.  **Stop All Containers**:

    ```bash
    docker compose down
    ```

2.  **View Logs for All Services**:

    ```bash
    docker compose logs -f
    ```

3.  **View Logs for a Specific Service** (e.g., the backend):

    ```bash
    docker compose logs -f backend
    ```

---

## 🗃️ 5. Database Migrations (Automated)

Use the migration runner to apply pending migrations safely.

- Apply (dev/local):
```bash
npm --prefix packages/api run migrate -- --host localhost
```

- Status and verify:
```bash
npm --prefix packages/api run migrate:status -- --host localhost
npm --prefix packages/api run migrate:verify -- --host localhost
```

- Production (on the server):
```bash
npm --prefix packages/api run migrate -- --host 127.0.0.1
```

Notes:
- Ensure production secrets exist before bringing up prod: `./secrets/db_password.txt`, `./secrets/jwt_secret.txt` (and optionally `./secrets/meili_key.txt`).
- In production, set `MEILISEARCH_HOST=http://meilisearch:7700` in `.env` so the backend can reach the Meilisearch service.