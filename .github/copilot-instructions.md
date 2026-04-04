# Copilot Instructions for Forson Business Suite

## Overview
The Forson Business Suite is a modular application with distinct components for API services and a web frontend. The backend is built using Node.js and Express, while the frontend leverages modern web technologies like Vite and Tailwind CSS. The application integrates with external services such as Meilisearch for search functionality and PostgreSQL for database management.

## Key Components

### Backend (`packages/api`)
- **Routes**: Organized by feature (e.g., `routes/partRoutes.js`, `routes/reportingRoutes.js`). Each route file defines RESTful endpoints.
- **Helpers**: Utility functions (e.g., `helpers/codeGenerator.js` for generating unique codes).
- **Middleware**: Authentication and authorization logic (e.g., `middleware/authMiddleware.js`).
- **Database**: SQL queries are embedded in route handlers, often using parameterized queries for security.
- **Meilisearch Integration**: Search-related logic is in `meilisearch.js` and `meilisearch-setup.js`.

### Frontend (`packages/web`)
- **Configuration**: Vite is used for bundling (`vite.config.js`), and Tailwind CSS is configured in `tailwind.config.js`.
- **Components**: Reusable UI components are in `src/components` (e.g., `TagInput.jsx`).
- **Public Assets**: Static files are in `public/`.

## Developer Workflows

### Setting Up the Environment
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development environment:
   - Backend: Use `docker-compose.dev.yml` to spin up services.
   - Frontend: Run `npm run dev` in the `packages/web` directory.

### Building and Testing
- **Build Frontend**: Run `npm run build` in `packages/web`.
- **Run Tests**: Add tests in the `__tests__` directory (not yet implemented).

### Debugging
- Use `console.log` for debugging backend services.
- For frontend, use browser developer tools.

## Project-Specific Conventions

### Code Patterns
- **Database Queries**: Use parameterized queries to prevent SQL injection.
- **Error Handling**: Wrap route handlers in `try-catch` blocks and log errors to the console.
- **Meilisearch Sync**: Ensure data consistency by syncing with Meilisearch after database updates.

### Naming Conventions
- **Routes**: Use kebab-case for route paths (e.g., `/api/reports/sales-summary`).
- **Variables**: Use camelCase for JavaScript variables.

## Integration Points
- **Meilisearch**: Configure indexes in `meilisearch-setup.js`.
- **PostgreSQL**: SQL scripts for schema initialization are in `database/initial_schema.sql`.

## Examples

### Adding a New API Route
1. Create a new file in `routes/` (e.g., `newFeatureRoutes.js`).
2. Define the route:
   ```javascript
   const express = require('express');
   const router = express.Router();

   router.get('/new-feature', (req, res) => {
       res.json({ message: 'New feature works!' });
   });

   module.exports = router;
   ```
3. Register the route in `index.js`:
   ```javascript
   const newFeatureRoutes = require('./routes/newFeatureRoutes');
   app.use('/api', newFeatureRoutes);
   ```

### Syncing Data with Meilisearch
1. Use the `syncPartWithMeili` helper function after database updates.
2. Example:
   ```javascript
   const { syncPartWithMeili } = require('../meilisearch');
   syncPartWithMeili(partData);
   ```

## Notes
- Follow the existing patterns in the codebase to maintain consistency.
- Refer to `README.md` for additional setup instructions.
