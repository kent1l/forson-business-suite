# Meilisearch Configuration Environment Variables

The Meilisearch setup has been enhanced with configurable options via environment variables. Add these to your `.env` file to customize behavior:

## Basic Configuration

```bash
# Environment (affects default settings)
NODE_ENV=development|staging|production

# Disable Meilisearch listeners for debugging
DISABLE_MEILI_LISTENERS=true
```

## Setup Retry Configuration

```bash
# Maximum number of retry attempts for setup operations (default: 4)
MEILI_SETUP_MAX_RETRIES=4

# Base delay in milliseconds for retry backoff (default: 200)
MEILI_SETUP_RETRY_DELAY=200
```

## Typo Tolerance Configuration

```bash
# Enable/disable typo tolerance (default: true in staging/production, configurable in development)
MEILI_TYPO_ENABLED=true

# Minimum word size for 1 typo tolerance (default: 4)
MEILI_TYPO_MIN_WORD_SIZE=4

# Minimum word size for 2 typo tolerance (default: 8)
MEILI_TYPO_MIN_WORD_SIZE_TWO=8
```

## Environment-Specific Defaults

### Development
- **Ranking Rules**: `['words', 'typo', 'exactness']` (simplified for faster indexing)
- **Typo Tolerance**: Configurable via `MEILI_TYPO_ENABLED`
- **Max Retries**: 2 (faster failures)

### Staging
- **Ranking Rules**: `['words', 'typo', 'proximity', 'attribute', 'exactness']`
- **Typo Tolerance**: Enabled
- **Max Retries**: 3

### Production
- **Ranking Rules**: `['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']` (full optimization)
- **Typo Tolerance**: Enabled
- **Max Retries**: 4

## Health Check Endpoints

The following health check endpoints are now available:

- `GET /api/health` - Basic API health check
- `GET /api/health/detailed` - Detailed health check including Meilisearch and database
- `GET /api/health/meilisearch` - Meilisearch-specific health and statistics
- `POST /api/health/meilisearch/reconfigure` - Trigger Meilisearch reconfiguration

## Error Handling Improvements

- **Graceful Degradation**: Setup failures no longer crash the server
- **Retry Logic**: Automatic retries for transient failures
- **Detailed Logging**: Better error messages and setup progress tracking
- **Validation**: Synonym file structure validation with helpful error messages

## Migration Notes

### Breaking Changes
- `setupMeiliSearch()` now returns a result object: `{ success: boolean, error?: string, errors?: string[] }`
- Server startup is no longer blocked by Meilisearch setup failures

### Backwards Compatibility
- All existing functionality continues to work
- Default settings remain the same for production environments
- Existing synonym files are automatically validated

## Example .env Configuration

```bash
# Development environment with custom settings
NODE_ENV=development
MEILI_TYPO_ENABLED=false
MEILI_SETUP_MAX_RETRIES=2
DISABLE_MEILI_LISTENERS=true

# Production environment with optimized settings
NODE_ENV=production
MEILI_SETUP_MAX_RETRIES=6
MEILI_SETUP_RETRY_DELAY=500
```