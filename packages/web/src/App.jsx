import React, { useState, useEffect } from 'react';
import api from './api';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import SetupPage from './pages/SetupPage';
import { SettingsProvider } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// AppContent remains the same, but it will now always have access to auth and settings
function AppContent() {
    const { user, isAuthenticated, login, logout } = useAuth();
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [posLines, setPosLines] = useState([]);

    const handleLogout = () => {
        logout();
        setPosLines([]);
    };

    if (!isAuthenticated) {
        return <LoginScreen onLogin={login} />;
    }

    return (
        <SettingsProvider>
            <MainLayout
                user={user}
                onLogout={handleLogout}
                currentPage={currentPage}
                onNavigate={setCurrentPage}
                posLines={posLines}
                setPosLines={setPosLines}
            />
        </SettingsProvider>
    );
}

// The main App component will now handle the initial setup check
function App() {
    const [needsSetup, setNeedsSetup] = useState(null);

    const checkSetupStatus = async () => {
        try {
            const response = await api.get('/setup/status');
            setNeedsSetup(!response.data.isAdminCreated);
        } catch (error) {
            console.error("Failed to check setup status", error);
            // Assume setup is needed if the check fails
            setNeedsSetup(true); 
        }
    };

    useEffect(() => {
        checkSetupStatus();
    }, []);

    // Display a loading indicator while checking the setup status
    if (needsSetup === null) {
        return <div>Loading configuration...</div>;
    }

    // If setup is needed, render only the SetupPage
    if (needsSetup) {
        return <SetupPage onSetupComplete={checkSetupStatus} />;
    }

    // If setup is complete, render the main application with AuthProvider
    return (
        <AuthProvider>
            <Toaster position="top-center" />
            <AppContent />
        </AuthProvider>
    );
}

export default App;