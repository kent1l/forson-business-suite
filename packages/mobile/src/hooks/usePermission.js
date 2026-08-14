import useAuthStore from '../store/useAuthStore';

/**
 * Permission checks that match the server's.
 *
 * The API grants `permission_level_id === 10` a blanket bypass in
 * `hasPermission` (packages/api/middleware/authMiddleware.js). Without the same
 * bypass here, an Admin would be shown a "no access" screen for a route the
 * server would happily serve -- the client would be stricter than the thing it
 * is guarding.
 */
const ADMIN_LEVEL = 10;

export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];
  const isAdmin = Number(user?.permission_level_id) === ADMIN_LEVEL;

  const hasPermission = (key) => isAdmin || permissions.includes(key);

  /** True when the user holds at least one of the keys. Mirrors the server's OR semantics. */
  const hasAny = (keys) => isAdmin || (Array.isArray(keys) ? keys : [keys]).some((k) => permissions.includes(k));

  const hasAll = (keys) => isAdmin || (Array.isArray(keys) ? keys : [keys]).every((k) => permissions.includes(k));

  return { hasPermission, hasAny, hasAll, isAdmin, permissions };
}

export default usePermission;
