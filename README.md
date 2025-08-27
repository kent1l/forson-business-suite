# 🏬 Forson Business Suite
An integrated ERP/Point-of-Sale solution for auto parts businesses.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker Ready](https://img.shields.io/badge/docker-ready-blue.svg)
![Status](https://img.shields.io/badge/status-in%20development-yellow.svg)

**Quick Links:**
[Overview](#overview) •
[Quick Start](#-quick-start) •
[Installation](#-installation--setup) •
[Architecture](#-architecture-overview) •
[Usage](#-usage) •
[API Samples](#-sample-api-calls) •
[Troubleshooting](#-troubleshooting) •
[Deployment](#-deployment-recommendations) •
[Contributing](#-contributing) •
[License](#-license)

---

## Overview
Forson Business Suite is a comprehensive, containerized business management application designed specifically for the auto parts industry. Built with a modern tech stack—**React** on the frontend, **Node.js/Express** for the API, and a **PostgreSQL** database—the entire suite is orchestrated with **Docker** for easy setup and deployment. It provides essential features like role-based access control, automated SKU generation, a full-featured Point of Sale (POS) system, and powerful reporting capabilities to streamline operations.

### Key Selling Points
- **Role-Based Authentication**: Secure access control for different user roles (e.g., Admin, Sales, Warehouse).
- **Automated SKU Generation**: Standardized product codes (`GROUP-BRAND-SEQ`) for consistent inventory management.
- **Integrated Point of Sale (POS)**: Fast, intuitive interface for processing sales and managing customer transactions.
- **Comprehensive Reporting**: Generate insights with detailed reports on sales, inventory, and profitability.

---

## ✨ Features
- **Authentication**: Secure JWT (JSON Web Token) based authentication with role management.
- **Inventory Management**: Full CRUD operations for parts, including stock adjustments and location tracking.
- **Entity Management**: Manage suppliers, customers, and vehicle applications (what parts fit what cars).
- **SKU Auto-Generation**: Automatically creates unique SKUs in the format `GROUP-BRAND-SEQUENTIAL_ID`.
- **Sales Workflow**: Full goods receipt, invoicing, and Point of Sale (POS) modules.
- **Power Search**: A unified search interface to quickly find parts, customers, or invoices.
- **Reporting & Analytics**: In-depth reporting with CSV export functionality.
- **Responsive UI**: Mobile-friendly interface built with React for access on any device.

---

## 🏗️ Architecture Overview
The application uses a classic three-tier architecture, which separates the presentation, application, and data layers. This makes the system scalable, maintainable, and secure.

```mermaid
graph TD
    A[Client Browser] -- HTTPS --> B(Web Server / React UI);
    B -- API Calls --> C(API Server / Node.js);
    C -- SQL Queries --> D(PostgreSQL Database);
    E(Backup Service) -- pg_dump --> D;
```

- **Client**: A responsive React single-page application served via Nginx.
- **API Server**: A stateless Node.js/Express server that handles business logic and communicates with the database.
- **Database**: A PostgreSQL instance for all persistent data.
- **Backup Service**: A simple cron-based service that runs `pg_dump` to create regular database backups. For production, a managed database with point-in-time recovery is highly recommended.

---

## 🚀 Quick Start
Get the entire suite running locally in minutes with Docker.

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/kent1l/forson-business-suite.git](https://github.com/kent1l/forson-business-suite.git)
    cd forson-business-suite
    ```

2.  **Repository Layout:**
    The project is a monorepo containing the frontend, backend, and database schema:
    - `packages/web`: The React frontend application.
    - `packages/api`: The Node.js/Express backend API.
    - `database`: Contains the `initial_schema.sql` file.
    - `docker-compose.yml`: The master file for orchestrating all services.

3.  **Build and Run with Docker Compose:**
    This single command builds the images and starts all the services in detached mode.
    ```bash
    docker compose up -d --build
    ```

4.  **Access the Application:**
    - **Frontend UI**: [http://localhost:8090](http://localhost:8090)
    - **Backend API**: [http://localhost:3001](http://localhost:3001)

---

## 🔧 Installation & Setup

### Prerequisites
- [Docker](https://www.docker.com/get-started) and Docker Compose
- [Git](https://git-scm.com/)
- (Optional) [Node.js](https://nodejs.org/) & npm for local development without Docker.

### Environment Variables
The API server requires environment variables for configuration. Create a `.env` file inside `packages/api/`.

**Important**: The `.env` file contains secrets and should **never** be committed to version control. The repository's `.gitignore` file is already configured to ignore it.

**Example `packages/api/.env` file:**
```env
# PostgreSQL Connection String
DATABASE_URL="postgresql://forson_user:your_strong_password@forson_db:5432/forson_business_suite"

# API Server Port
PORT=3001

# JWT Secret for signing tokens (use a long, random string)
JWT_SECRET="your_super_secret_jwt_key_here"

# Node environment
NODE_ENV=development
```
> **Security Note**: Ensure `your_strong_password` matches the `POSTGRES_PASSWORD` variable in `docker-compose.yml`.

### (Optional) Local Frontend Build
If you wish to build the frontend without Docker:
```bash
cd packages/web
npm install
npm run build
```

### Database Initialization
After starting the containers for the first time, you need to initialize the database schema.

1.  **Copy the schema file into the database container:**
    ```bash
    docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
    ```

2.  **Execute the schema file using `psql`:**
    ```bash
    docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
    ```

**Alternative Method (Interactive Shell):**
You can also get a shell inside the container and run `psql` manually.
```bash
# 1. Get a bash shell in the db container
docker exec -it forson_db bash

# 2. Once inside, connect to the database and run the script
psql -U forson_user -d forson_business_suite -f /initial_schema.sql

# 3. Exit the container
exit
```

---

## 💡 Usage

Once the application is running and the database is initialized, navigate to [http://localhost:8090](http://localhost:8090) to begin. The default setup may require creating an initial admin user or running a seed script (see `database/` directory for future seeding scripts).

### Sample API Calls
You can interact with the API directly using `curl` or any API client.

**GET all active suppliers:**
```bash
curl -X GET http://localhost:3001/api/suppliers?active=true
```

**GET a specific part by its ID (e.g., ID 123):**
```bash
curl -X GET http://localhost:3001/api/parts/123
```

**POST to create a new supplier:**
```bash
curl -X POST http://localhost:3001/api/suppliers \
-H "Content-Type: application/json" \
-d '{
  "name": "Global Auto Parts Inc.",
  "contact_person": "Jane Doe",
  "email": "jane.doe@globalparts.com",
  "phone": "123-456-7890"
}'
```

---

## 🛠️ Troubleshooting
If you encounter issues, here are some initial steps to diagnose the problem.

- **Check container status:**
  ```bash
  docker compose ps
  # or
  docker ps
  ```

- **View logs for a specific service (e.g., the API):**
  ```bash
  docker compose logs -f api
  ```

- **Common Issues:**
  - **`injecting env (0)` in logs / API fails to start**: This usually means the `.env` file is missing from `packages/api/`. Make sure you've created it and that it's in the correct directory.
  - **Database Connection Errors**:
    - Verify the `DATABASE_URL` in `packages/api/.env` exactly matches the user, password, host (`forson_db`), and database name defined in `docker-compose.yml`.
    - Ensure the database container (`forson_db`) is running and healthy by checking `docker compose ps`.

---

## ☁️ Deployment Recommendations
For a production environment, consider the following enhancements:

- **Managed Database**: Use a managed PostgreSQL service (like AWS RDS, Google Cloud SQL, or DigitalOcean Managed Databases) for automated backups, scaling, and reliability.
- **Secret Management**: Store sensitive environment variables (like `DATABASE_URL` and `JWT_SECRET`) in a secure secret manager (e.g., AWS Secrets Manager, HashiCorp Vault).
- **Orchestration**: For high availability and scaling, deploy the containers using an orchestrator like Kubernetes.
- **Backup and Restore**: Regularly test your database backup and restore process to ensure data integrity.

---

## 🧾 Deployment

This project includes two common deployment workflows: a developer-friendly local workflow for development and a production workflow that relies on a registry and a server (or orchestration platform). Choose the one that matches your environment.

### Development — Local (Docker Compose)

Use this workflow when you're working on features locally or want a quick, reproducible environment.

1. Ensure Docker and Docker Compose are installed.
2. Copy or create environment files used by the services:

```powershell
# from project root
cp .env.example packages/api/.env
# Edit packages/api/.env with local credentials if needed
```

3. Build images and start services:

```powershell
# from project root
docker compose up -d --build
```

4. Initialize the database (one-time):

```powershell
# copy schema into the running db container (example service name: forson_db)
docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
```

5. Check status & logs:

```powershell
docker compose ps
docker compose logs -f api
```

6. Stop and remove containers when finished:

```powershell
docker compose down --volumes
```

Notes:
- Use `docker compose up --build` to rebuild only when necessary.
- Keep your `packages/api/.env` file out of source control.

### Production — Server (Docker Compose + Registry)

This workflow assumes you push images to a container registry (e.g., GitHub Container Registry `ghcr.io` or Docker Hub) from CI, then pull and run them on the server. The repository includes a `docker-compose.prod.yml` tailored for production settings.

1. Build and push images (CI or local):

```bash
# Example: build and push to GHCR (CI will handle this automatically)
docker build -t ghcr.io/<owner>/<repo>/api:$(git rev-parse --short HEAD) ./packages/api
docker push ghcr.io/<owner>/<repo>/api:$(git rev-parse --short HEAD)

docker build -t ghcr.io/<owner>/<repo>/web:$(git rev-parse --short HEAD) ./packages/web
docker push ghcr.io/<owner>/<repo>/web:$(git rev-parse --short HEAD)
```

2. Prepare the server

- Copy `docker-compose.prod.yml` to the server and create a `.env` file with production values or configure Docker secrets.
- Ensure the server has Docker and Docker Compose installed and sufficient resources.

3. Pull images and perform a zero-downtime update using Compose:

```bash
# on the server, in the compose folder
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

4. Database migrations & backups

- Always take a backup before applying migrations:

```bash
# example backup command (adjust service name)
docker exec -t forson_db pg_dump -U forson_user forson_business_suite | gzip > backup-$(date -Iseconds).sql.gz
```

- Apply migrations (depending on your migration strategy). You can run SQL scripts inside the DB container or run your migration tool from the API container.

5. Rollback strategy

- Keep the previous image tag available in the registry. To rollback:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-deps --build api=ghcr.io/<owner>/<repo>/api:<previous-tag>
```

6. Useful server-side tips

- Use a process like `systemd` to ensure `docker compose` stack is started on boot (create a `systemd` unit that runs `docker compose up -d`).
- Use monitoring (Prometheus/Grafana) and log aggregation (ELK, Loki) for observability.
- Use a secrets manager or Docker Secrets for sensitive values—avoid plain `.env` in production.

---

If you'd like, I can also add a small `deploy.sh` helper and a `systemd` unit example to the repo to simplify server-side deployments.

---

## 📊 Reporting & Exports
The suite includes a powerful reporting module to provide key business insights. Users can generate various reports and export the data to **CSV format** for further analysis in spreadsheet software.

Available reports include:
- Sales summaries (by period, customer, or employee)
- Inventory valuation
- Top-selling products
- Low stock alerts
- Full audit trail of inventory movements
- Profitability analysis

---

## 🤝 Contributing
We welcome contributions! Please follow this workflow to get started.

1.  **Fork the repository.**
2.  **Create a new branch** for your feature or bug fix. Use a descriptive name like `feat/add-new-report` or `fix/login-bug`.
3.  Commit your changes and push them to your fork.
4.  **Open a Pull Request (PR)** against the `main` branch of the original repository.
5.  Provide a clear description of your changes in the PR.
6.  For major changes, please **open an issue first** to discuss the proposed changes.

**Guidelines:**
- Adhere to the existing code style.
- Ensure no secrets or `.env` files are included in your commits or PRs.

---

## 📜 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for full details.

---

<p align="center">
  Thank you for checking out Forson Business Suite! If you find a bug or have a feature request, please <a href="https://github.com/kent1l/forson-business-suite/issues">open an issue</a>.
</p>
