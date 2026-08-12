import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import api from '../api';
import useLocalStorage from '../hooks/useLocalStorage';
import { generateShadeRamp } from '../utils/colorRamp';

const ThemeContext = createContext();

const DEFAULT_LIGHT = { primary: '#2563eb', accent: '#7c3aed' };
const DEFAULT_DARK = { primary: '#3b82f6', accent: '#a78bfa' };

const TOKEN_ORDER = [50, 100, 500, 600, 700, 900];

function applyRamp(tokenName, ramp) {
    if (!ramp) return;
    TOKEN_ORDER.forEach((step) => {
        document.documentElement.style.setProperty(`--color-${tokenName}-${step}`, ramp[step]);
    });
}

function applyFavicon(updatedAt) {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    const img = new Image();
    img.onload = () => {
        link.href = `/api/branding/logo/icon?v=${updatedAt || Date.now()}`;
    };
    img.onerror = () => {
        // No custom icon uploaded - leave the existing static favicon in place.
    };
    img.src = `/api/branding/logo/icon?v=${updatedAt || Date.now()}`;
}

export const ThemeProvider = ({ children }) => {
    const [mode, setMode] = useLocalStorage('forson_theme_mode', null); // null = follow system
    const [systemPrefersDark, setSystemPrefersDark] = useState(
        () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    );
    const [brandColors, setBrandColors] = useState(null);

    const resolvedMode = mode || (systemPrefersDark ? 'dark' : 'light');

    const fetchTheme = useCallback(async () => {
        try {
            const { data } = await api.get('/branding/theme');
            setBrandColors(data);
        } catch (error) {
            console.error('Failed to fetch brand theme, using defaults', error);
            setBrandColors({});
        }
    }, []);

    useEffect(() => {
        fetchTheme();
    }, [fetchTheme]);

    // Track OS-level dark mode preference for the "system" default.
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (e) => setSystemPrefersDark(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    // Toggle the `dark` class that the CSS custom-variant in index.css keys off of.
    useEffect(() => {
        document.documentElement.classList.toggle('dark', resolvedMode === 'dark');
    }, [resolvedMode]);

    // Write the primary/accent shade ramps as CSS custom properties whenever
    // the saved brand colors or the light/dark mode changes.
    useEffect(() => {
        if (!brandColors) return;
        const defaults = resolvedMode === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT;
        const primaryHex = resolvedMode === 'dark'
            ? (brandColors.BRAND_PRIMARY_COLOR_DARK || brandColors.BRAND_PRIMARY_COLOR || defaults.primary)
            : (brandColors.BRAND_PRIMARY_COLOR || defaults.primary);
        const accentHex = resolvedMode === 'dark'
            ? (brandColors.BRAND_ACCENT_COLOR_DARK || brandColors.BRAND_ACCENT_COLOR || defaults.accent)
            : (brandColors.BRAND_ACCENT_COLOR || defaults.accent);

        applyRamp('primary', generateShadeRamp(primaryHex));
        applyRamp('accent', generateShadeRamp(accentHex));
    }, [brandColors, resolvedMode]);

    useEffect(() => {
        applyFavicon();
    }, [brandColors]);

    const toggleMode = () => setMode(resolvedMode === 'dark' ? 'light' : 'dark');

    return (
        <ThemeContext.Provider value={{ mode: resolvedMode, toggleMode, setMode, refetchTheme: fetchTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
