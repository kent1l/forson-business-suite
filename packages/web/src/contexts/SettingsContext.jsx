import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../api';

const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await api.get('/settings');
                setSettings(response.data);
            } catch (error) {
                console.error("Failed to fetch settings", error);
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    return (
        <SettingsContext.Provider value={{ settings, loading }}>
            {!loading && children}
        </SettingsContext.Provider>
    );
};

// Custom hook for easy access to the context
export const useSettings = () => {
    return useContext(SettingsContext);
};
