/* eslint-disable no-unused-vars */
import { useState, useEffect } from 'react';
import api from './api';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import SetupPage from './pages/SetupPage';
import { SettingsProvider } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import MobileSetupPage from './pages/MobileSetupPage';

// AppContent remains the same, but it will now always have access to auth and settings
function AppContent() {
    const { user, isAuthenticated, login, logout } = useAuth();
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [pageState, setPageState] = useState(null);
    const [posLines, setPosLines] = useState([]);

    const handleLogout = () => {
        logout();
        setPosLines([]);
    };

    const handleNavigate = (page, state = null) => {
        setCurrentPage(page);
        setPageState(state);
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
                onNavigate={handleNavigate}
                pageState={pageState}
                posLines={posLines}
                setPosLines={setPosLines}
            />
        </SettingsProvider>
    );
}

// The main App component will now handle the initial setup check
function App() {
    const [needsSetup, setNeedsSetup] = useState(null);
    const isMobileSetup = window.location.pathname === '/mobile-setup';

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
        if (!isMobileSetup) {
            checkSetupStatus();
        }
    }, [isMobileSetup]);

    // Intercept mobile setup route immediately to bypass auth and setup checks
    if (isMobileSetup) {
        return <MobileSetupPage />;
    }

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