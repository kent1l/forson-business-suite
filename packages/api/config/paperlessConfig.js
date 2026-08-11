'use strict';

/**
 * Paperless-ngx Configuration Module
 * Loads connection parameters dynamically from environment variables with safe defaults.
 */
function getPaperlessConfig() {
    const rawUrl = process.env.PAPERLESS_API_URL || '';
    let apiUrl = rawUrl.trim();

    // Ensure URL ends cleanly without duplicate trailing slashes
    if (apiUrl.endsWith('/')) {
        apiUrl = apiUrl.slice(0, -1);
    }

    const apiToken = (process.env.PAPERLESS_API_TOKEN || '').trim();
    const timeoutSeconds = parseInt(process.env.PAPERLESS_TIMEOUT_SECONDS || '30', 10);
    const verifySsl = process.env.PAPERLESS_VERIFY_SSL !== 'false' && process.env.PAPERLESS_VERIFY_SSL !== '0';

    return {
        apiUrl,
        apiToken,
        timeoutMs: (isNaN(timeoutSeconds) || timeoutSeconds <= 0 ? 30 : timeoutSeconds) * 1000,
        verifySsl,
        isConfigured: Boolean(apiUrl && apiToken),
    };
}

module.exports = { getPaperlessConfig };
