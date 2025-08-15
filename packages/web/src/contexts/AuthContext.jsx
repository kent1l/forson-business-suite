import React, { createContext, useState, useContext, useCallback } from 'react';

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
    const logout = useCallback(() => {
        localStorage.removeItem('userSession');
        setUser(null);
        setPermissions([]);
    }, []);

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
