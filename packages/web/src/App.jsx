import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import SetupPage from './pages/SetupPage'; // 1. Import the new page
import { SettingsProvider } from './contexts/SettingsContext';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [needsSetup, setNeedsSetup] = useState(null); // null = loading, true = needs setup, false = setup complete

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
                onNavigate={setCurrentPage}
                posLines={[]} // Placeholder for POS state
                setPosLines={() => {}} // Placeholder for POS state
            />
        </SettingsProvider>
    );
}

export default App;
