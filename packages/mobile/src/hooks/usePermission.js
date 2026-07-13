import useAuthStore from '../store/useAuthStore';

export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];

  const hasPermission = (key) => permissions.includes(key);

  return { hasPermission, permissions };
}
