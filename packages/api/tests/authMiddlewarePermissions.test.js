const { hasPermission } = require('../middleware/authMiddleware');

describe('authMiddleware hasPermission', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: 'GET',
      originalUrl: '/test',
      user: {
        permission_level_id: 2,
        permissions: ['pos:use', 'inventory:view'],
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('allows admin users (level 10) to bypass granular checks', () => {
    req.user.permission_level_id = 10;
    req.user.permissions = [];
    
    const middleware = hasPermission('any:permission');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows single permission check when user has permission', () => {
    const middleware = hasPermission('pos:use');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when single permission is missing', () => {
    const middleware = hasPermission('customers:edit');
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden: You do not have the required permission.' });
  });

  it('allows array of permissions when user has at least one matching permission', () => {
    const middleware = hasPermission(['customers:view', 'pos:use']);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when user has none of the permissions in the array', () => {
    const middleware = hasPermission(['customers:view', 'customers:edit']);
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
