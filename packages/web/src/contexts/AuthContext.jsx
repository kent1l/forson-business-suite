/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        const sessionData = localStorage.getItem('userSession');
        if (sessionData) {
            const parsedData = JSON.parse(sessionData);
            return parsedData.user || null;
        }
        return null;
    });
    const [permissions, setPermissions] = useState(() => {
        const sessionData = localStorage.getItem('userSession');
        if (sessionData) {
            const parsedData = JSON.parse(sessionData);
            return parsedData.permissions || []; 
        }
        return [];
    });

    const login = (loginData) => {
        const sessionData = {
            user: loginData.user,
            token: loginData.token,
            permissions: loginData.permissions
        };
        localStorage.setItem('userSession', JSON.stringify(sessionData));
        setUser(loginData.user);
        setPermissions(loginData.permissions);
    };

    // Wrap logout in useCallback so it can be used in useEffect dependency arrays
    // options: { reload: boolean } - reload can be used for forced auto-logout to ensure UI shows login
    const logout = useCallback((options = {}) => {
        localStorage.removeItem('userSession');
        setUser(null);
        setPermissions([]);
        if (options.reload) {
            // small timeout to allow state updates to flush in other tabs
            setTimeout(() => window.location.reload(), 50);
        }
    }, []);

    // Helper to check JWT expiry (returns true if expired)
    const isTokenExpired = (token) => {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            const payload = JSON.parse(atob(parts[1]));
            if (!payload.exp) return false;
            return payload.exp < Math.floor(Date.now() / 1000);
        } catch {
            return false;
        }
    };

    // Listen for global auth errors (dispatched by the api interceptor) and auto logout
    useEffect(() => {
        const handleAuthError = () => {
            // forced logout for expired/invalid session: clear and reload to show login
            logout({ reload: true });
        };
        window.addEventListener('auth-error', handleAuthError);
        return () => window.removeEventListener('auth-error', handleAuthError);
    }, [logout]);

    // Sync logout across tabs and check token expiry on mount
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key === 'userSession' && e.newValue === null) {
                // Another tab logged out
                setUser(null);
                setPermissions([]);
            }
        };

        try {
            const sessionData = JSON.parse(localStorage.getItem('userSession'));
            if (sessionData && sessionData.token && isTokenExpired(sessionData.token)) {
                logout();
            }
        } catch {
            // ignore parse errors
        }

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [logout]);

    const hasPermission = useCallback((requiredPermission) => {
        if (!Array.isArray(permissions)) {
            console.error("Permissions is not an array:", permissions);
            return false;
        }
        return permissions.includes(requiredPermission);
    }, [permissions]);

    const value = {
        user,
        permissions,
        login,
        logout,
        hasPermission,
        isAuthenticated: !!user
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    return useContext(AuthContext);
};
