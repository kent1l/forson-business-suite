const { hasPermission } = require('../middleware/authMiddleware');

describe('RBAC Route Guards', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            method: 'GET',
            originalUrl: '/test',
            user: { username: 'testuser', permission_level_id: 2 }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        mockNext = jest.fn();
    });

    it('should bypass permissions for admin (permission_level_id = 10)', () => {
        mockReq.user.permission_level_id = 10;
        const middleware = hasPermission('some:permission');
        middleware(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 if user is not attached to request and token bypassed', () => {
        delete mockReq.user;
        const middleware = hasPermission('some:permission');
        middleware(mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({ message: 'Forbidden: You do not have the required permission.' });
    });

    it('should allow access if user has one of the required permissions', () => {
        mockReq.user.permissions = ['customers:view', 'pos:use'];
        const middleware = hasPermission('customers:view');
        middleware(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 if user lacks required permissions', () => {
        mockReq.user.permissions = ['pos:use'];
        const middleware = hasPermission('customers:edit');
        middleware(mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({ message: 'Forbidden: You do not have the required permission.' });
    });
});
