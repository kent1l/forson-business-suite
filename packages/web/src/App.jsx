import React, { useState, useEffect } from 'react';
import api from './api';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import SetupPage from './pages/SetupPage';
import { SettingsProvider } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

function AppContent() {
    const { user, isAuthenticated, login, logout } = useAuth();
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [needsSetup, setNeedsSetup] = useState(null);
    const [posLines, setPosLines] = useState([]);

    const checkSetupStatus = async () => {
        try {
            const response = await api.get('/setup/status');
            setNeedsSetup(!response.data.isAdminCreated);
        } catch (error) {
            console.error("Failed to check setup status", error);
            setNeedsSetup(true); 
        }
    };

    useEffect(() => {
        checkSetupStatus();

        // NEW: Event listener to handle session expiry gracefully
        const handleAuthError = () => {
            logout();
        };

        window.addEventListener('auth-error', handleAuthError);

        // Cleanup the event listener when the component unmounts
        return () => {
            window.removeEventListener('auth-error', handleAuthError);
        };
    }, [logout]); // Add logout as a dependency

    const handleLogout = () => {
        logout();
        setPosLines([]);
    };

    const handleNavigate = (page) => {
        setCurrentPage(page);
    };

    if (needsSetup === null) {
        return <div>Loading...</div>;
    }

    if (needsSetup) {
        return <SetupPage onSetupComplete={checkSetupStatus} />;
    }

    if (!isAuthenticated) {
        return <LoginScreen onLogin={login} />;
    }

    return (
        <MainLayout
            user={user}
            onLogout={handleLogout}
            currentPage={currentPage}
            onNavigate={handleNavigate}
            posLines={posLines}
            setPosLines={setPosLines}
        />
    );
}

function App() {
    return (
        <AuthProvider>
            <SettingsProvider>
                <Toaster position="top-center" />
                <AppContent />
            </SettingsProvider>
        </AuthProvider>
    );
}

export default App;
