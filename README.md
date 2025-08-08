# Forson Business Suite

A modern, full-stack inventory management and point-of-sale (POS) application designed to replace a legacy MS Access system. Built with a professional tech stack including React, Node.js, and PostgreSQL, and fully containerized with Docker for easy deployment.

---

## ✨ Key Features

* **Secure Authentication:** Full user login system with JWT-based security and role-based access control (Admin, Manager, Clerk).
* **Comprehensive Inventory Management:** Full CRUD (Create, Read, Update, Delete) functionality for parts, suppliers, customers, and vehicle applications.
* **Intelligent SKU Generation:** Automatic, professional SKU creation (`GROUP-BRAND-SEQ`) for new parts.
* **Advanced Part Management:** Manage multiple part numbers and vehicle applications (with year ranges) for each inventory item.
* **Transactional Workflows:**
    * **Goods Receipt:** A dedicated interface for receiving stock from suppliers, which automatically updates inventory levels.
    * **Invoicing & POS:** A fast, modern Point of Sale interface for immediate sales and a detailed invoicing page for credit-based transactions.
* **Dynamic Settings:** A secure, admin-only page to manage application-wide settings like company info, payment methods, and tax rates.
* **Powerful Searching:**
    * Live search bars on all main data pages.
    * A dedicated "Power Search" page with multi-field filtering for deep inventory analysis.
* **Professional Reporting:** A tabbed reporting dashboard with date filters and CSV export for:
    * Sales Summary
    * Inventory Valuation
    * Top-Selling Products
    * Low Stock Items
    * Sales by Customer
    * Full Inventory Movement (Audit Trail)
    * Profitability by Product
* **Modern UI/UX:** Built with a clean, responsive design that works on desktop and mobile, featuring toast notifications for a smooth user experience.

---

## 🚀 Tech Stack

| Area       | Technology                               |
| :--------- | :--------------------------------------- |
| **Frontend** | React, Vite, Tailwind CSS, Axios, Recharts |
| **Backend** | Node.js, Express.js                      |
| **Database** | PostgreSQL                               |
| **Deployment** | Docker, Nginx                            |

---

## 📦 Local Deployment (Docker)

This project is fully containerized, making local setup incredibly simple.

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
* A `.env` file inside the `packages/api` directory with your database credentials and a `JWT_SECRET`.

### Instructions

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd forson-business-suite
    ```

2.  **Build the Frontend:**
    Navigate to the web package and create a production build.
    ```bash
    cd packages/web
    npm install
    npm run build
    cd ../.. 
    ```

3.  **Run with Docker Compose:**
    From the root of the project, run the following command. This will build and start the database, backend, and frontend containers.
    ```bash
    docker compose up -d --build
    ```

4.  **Initialize the Database:**
    The first time you run the application, you need to create the database schema.
    ```bash
    docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
    docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
    ```

5.  **Access the Application:**
    The application is now running. You can access it in your browser at:
    [**http://localhost:8080**](http://localhost:8080)

    The first time you access the app, it will prompt you to create the initial administrator account.

---

## 📁 Project Structure

This project is a monorepo containing two main packages:

* **`packages/api`**: The Node.js/Express backend server and all related API logic.
* **`packages/web`**: The React/Vite frontend application and all UI components.