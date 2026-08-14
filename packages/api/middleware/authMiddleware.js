const jwt = require('jsonwebtoken');
const db = require('../db'); // Import db to fetch permissions

// Middleware to verify the token and attach user with permissions
const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Resolve the employee row itself rather than trusting the token's
            // claims. A JWT lives for a day, so reading permission_level_id from
            // the token meant a deactivated employee — or one whose system access
            // was revoked via DELETE /employees/:id/access — kept full access
            // until their token happened to expire.
            const userRes = await db.query(
                `SELECT e.employee_id, e.username, e.is_active, e.permission_level_id,
                        COALESCE(
                            ARRAY_AGG(p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL),
                            '{}'
                        ) AS permissions
                 FROM employee e
                 LEFT JOIN role_permission rp ON rp.permission_level_id = e.permission_level_id
                 LEFT JOIN permission p ON p.permission_id = rp.permission_id
                 WHERE e.employee_id = $1
                 GROUP BY e.employee_id`,
                [decoded.employee_id]
            );

            const account = userRes.rows[0];
            // No row, deactivated, or credentials revoked (permission_level_id
            // NULLed) all mean the token must no longer be honoured.
            if (!account || !account.is_active || account.permission_level_id === null) {
                return res.status(401).json({ message: 'Not authorized' });
            }

            const permissions = account.permissions || [];

            // The role comes from the database, not the token, so a demotion
            // takes effect on the next request instead of the next login.
            req.user = {
                ...decoded,
                employee_id: account.employee_id,
                username: account.username,
                permission_level_id: account.permission_level_id,
                permissions,
            };

            // Debug: log basic user info (do not log tokens) to help trace permission checks during development
            console.log(`Authenticated user: username=${decoded.username || decoded.user || 'unknown'} permission_level=${decoded.permission_level_id} permissions=${permissions.join(',')}`);
            next();
        } catch (error) {
            // Log detailed JWT error for debugging (do not leak tokens in production logs)
            console.error('JWT verification failed:', error && error.message ? error.message : error);
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// NEW: Middleware generator to check for a specific permission (accepts string or array of strings)
const hasPermission = (requiredPermission) => {
    return (req, res, next) => {
        const requiredList = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];

        // Extra debug: surface auth header and user presence to help trace 403s
        try {
            const authPresent = !!(req.headers && req.headers.authorization);
            const userPresent = !!req.user;
            console.log(`hasPermission invoked: required=${requiredList.join(',')} method=${req.method} url=${req.originalUrl} authHeaderPresent=${authPresent} userPresent=${userPresent}`);
        } catch {
            // ignore logging errors
        }
        // Coerce permission level to number for robust checks
        const userLevel = req.user && req.user.permission_level_id ? Number(req.user.permission_level_id) : null;

        // Allow admins to bypass granular permission checks
        if (userLevel === 10) {
            console.log(`Permission bypass (admin) for ${req.method} ${req.originalUrl} user=${req.user?.username || 'unknown'}`);
            return next();
        }

        if (req.user && Array.isArray(req.user.permissions) && requiredList.some(p => req.user.permissions.includes(p))) {
            console.log(`Permission allowed for ${req.method} ${req.originalUrl} user=${req.user?.username || 'unknown'} permissions=${requiredList.join(',')}`);
            return next();
        }

        // Detailed logging helps debug permission issues in development
        console.warn(`Permission check failed for ${req.method} ${req.originalUrl} user=${req.user?.username || 'unknown'} permission_level=${req.user?.permission_level_id} required=${requiredList.join(',')}`);
        return res.status(403).json({ message: 'Forbidden: You do not have the required permission.' });
    };
};

// Kept for backwards compatibility or specific high-level checks if needed
const isAdmin = (req, res, next) => {
    if (req.user && req.user.permission_level_id === 10) {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

/**
 * The same check `hasPermission` performs, usable inside a handler.
 *
 * Some routes are open to a broad permission but must behave differently for
 * privileged callers — filing leave is allowed for everyone, but only someone
 * with `leave:manage` may file it on another employee's behalf. Expressing that
 * as middleware would need two routes; expressing it inline needs this.
 *
 * Mirrors the middleware exactly, including the level-10 admin bypass, so the
 * two can never drift apart.
 */
const userHasPermission = (req, requiredPermission) => {
    const requiredList = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    const userLevel = req.user && req.user.permission_level_id ? Number(req.user.permission_level_id) : null;
    if (userLevel === 10) return true;
    return !!(req.user && Array.isArray(req.user.permissions)
        && requiredList.some((p) => req.user.permissions.includes(p)));
};

module.exports = { protect, isAdmin, hasPermission, userHasPermission };
