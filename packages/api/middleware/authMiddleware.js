const jwt = require('jsonwebtoken');

// Middleware to verify the token on incoming requests
const protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Attach user to the request (excluding password details)
            req.user = decoded;
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

// Middleware to check if the user is an Admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.permission_level_id === 10) {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' }); // 403 Forbidden
    }
};

// NEW: Middleware to check if the user is a Manager or Admin
const isManagerOrAdmin = (req, res, next) => {
    if (req.user && req.user.permission_level_id >= 5) {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized for this action' });
    }
};


module.exports = { protect, isAdmin, isManagerOrAdmin };
