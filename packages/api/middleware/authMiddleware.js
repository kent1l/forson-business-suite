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
            next();
        } catch (error) {
            console.error(error);
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
        if (req.user && req.user.permissions && req.user.permissions.includes(requiredPermission)) {
            next();
        } else {
            res.status(403).json({ message: 'Forbidden: You do not have the required permission.' });
        }
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
