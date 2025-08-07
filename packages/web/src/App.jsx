import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import { SettingsProvider } from './contexts/SettingsContext'; // 1. Import the provider

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    useEffect(() => {
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

    if (!user) {
        return (
            <>
                <Toaster position="top-center" /> 
                <LoginScreen onLogin={handleLogin} />
            </>
        );
    }

    return (
        // 2. Wrap the main layout with the provider
        <SettingsProvider>
            <Toaster position="top-center" /> 
            <MainLayout
                user={user}
                onLogout={handleLogout}
                currentPage={currentPage}
                onNavigate={setCurrentPage}
            />
        </SettingsProvider>
    );
}

export default App;
