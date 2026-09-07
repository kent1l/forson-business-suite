/**
 * The single error type the analytics layer throws for anything a caller could
 * have got right by sending a different request.
 *
 * Every 400 carries `details` naming what was rejected and what would have been
 * accepted. An analytics request is assembled from a registry the caller cannot
 * see, so "invalid request" on its own is unactionable -- the message has to
 * name the metric, the dimension, and the reason the pair is impossible.
 */
class AnalyticsRequestError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.name = 'AnalyticsRequestError';
        this.status = status;
        this.details = details;
    }
}

/**
 * Thrown at require() time by the registry when a cross-reference does not
 * resolve. Deliberately NOT an AnalyticsRequestError: it is a programming
 * error, and the server must refuse to boot rather than serve one broken tile.
 */
class AnalyticsRegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AnalyticsRegistryError';
    }
}

module.exports = { AnalyticsRequestError, AnalyticsRegistryError };
