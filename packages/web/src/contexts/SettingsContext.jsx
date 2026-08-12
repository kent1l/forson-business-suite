import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../api';

const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);

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

    useEffect(() => {
        fetchSettings();
    }, []);

    // Re-fetches settings without a full page reload, e.g. after saving
    // brand colors so the new theme applies immediately app-wide.
    const refetchSettings = () => fetchSettings();

    return (
        <SettingsContext.Provider value={{ settings, loading, refetchSettings }}>
            {!loading && children}
        </SettingsContext.Provider>
    );
};

// Custom hook for easy access to the context
export const useSettings = () => {
    return useContext(SettingsContext);
};
