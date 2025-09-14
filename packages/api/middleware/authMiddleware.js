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

            // Fetch user permissions from the database
            const permissionsRes = await db.query(
                `SELECT p.permission_key 
                 FROM permission p
                 JOIN role_permission rp ON p.permission_id = rp.permission_id
                 WHERE rp.permission_level_id = $1`,
                [decoded.permission_level_id]
            );
            
            const permissions = permissionsRes.rows.map(p => p.permission_key);

            // Attach user and their permissions to the request
            req.user = { ...decoded, permissions };

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

// NEW: Middleware generator to check for a specific permission
const hasPermission = (requiredPermission) => {
    return (req, res, next) => {
        // Extra debug: surface auth header and user presence to help trace 403s
        try {
            const authPresent = !!(req.headers && req.headers.authorization);
            const userPresent = !!req.user;
            console.log(`hasPermission invoked: required=${requiredPermission} method=${req.method} url=${req.originalUrl} authHeaderPresent=${authPresent} userPresent=${userPresent}`);
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

        if (req.user && Array.isArray(req.user.permissions) && req.user.permissions.includes(requiredPermission)) {
            console.log(`Permission allowed for ${req.method} ${req.originalUrl} user=${req.user?.username || 'unknown'} permission=${requiredPermission}`);
            return next();
        }

        // Detailed logging helps debug permission issues in development
        console.warn(`Permission check failed for ${req.method} ${req.originalUrl} user=${req.user?.username || 'unknown'} permission_level=${req.user?.permission_level_id} required=${requiredPermission}`);
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

module.exports = { protect, isAdmin, hasPermission };
