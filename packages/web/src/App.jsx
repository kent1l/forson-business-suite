import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import SetupPage from './pages/SetupPage';
import { SettingsProvider } from './contexts/SettingsContext';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [needsSetup, setNeedsSetup] = useState(null); // null = loading, true = needs setup, false = setup complete
    
    // Proper POS state management at the App level
    const [posLines, setPosLines] = useState([]);

    const checkSetupStatus = async () => {
        try {
            const response = await axios.get('http://localhost:3001/api/setup/status');
            setNeedsSetup(!response.data.isAdminCreated);
        } catch (error) {
            console.error("Failed to check setup status", error);
            // Handle case where backend might be down
            setNeedsSetup(true); 
        }
    };

    useEffect(() => {
        checkSetupStatus();
        const sessionData = localStorage.getItem('userSession');
        if (sessionData) {
            const parsedData = JSON.parse(sessionData);
            setUser(parsedData.user);
        }
    }, []);

    const handleLogin = (loginData) => {
        const sessionData = {
            user: loginData.user,
            token: loginData.token
        };
        localStorage.setItem('userSession', JSON.stringify(sessionData));
        setUser(loginData.user);
    };

    const handleLogout = () => {
        localStorage.removeItem('userSession');
        setUser(null);
        // Clear POS cart on logout for security/privacy
        setPosLines([]);
    };

    // Clear POS cart when navigating away from POS (optional - for UX)
    const handleNavigate = (page) => {
        // Optionally clear cart when leaving POS page
        if (currentPage === 'pos' && page !== 'pos' && posLines.length > 0) {
            // Could add a confirmation dialog here if needed
            // For now, we'll preserve the cart across navigation
        }
        setCurrentPage(page);
    };

    // --- Render Logic ---

    if (needsSetup === null) {
        return <div>Loading...</div>; // Show a loading screen while checking setup status
    }

    if (needsSetup) {
        return <SetupPage onSetupComplete={checkSetupStatus} />;
    }

    if (!user) {
        return (
            <>
                <Toaster position="top-center" /> 
                <LoginScreen onLogin={handleLogin} />
            </>
        );
    }

    return (
        <SettingsProvider>
            <Toaster position="top-center" /> 
            <MainLayout
                user={user}
                onLogout={handleLogout}
                currentPage={currentPage}
                onNavigate={handleNavigate}
                posLines={posLines}
                setPosLines={setPosLines}
            />
        </SettingsProvider>
    );
}

export default App;