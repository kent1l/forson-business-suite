import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';
import { SettingsProvider } from './contexts/SettingsContext';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [posLines, setPosLines] = useState([]); // POS cart state is now here

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

    return (
        <SettingsProvider>
            <Toaster position="top-center" /> 
            { !user ? (
                <LoginScreen onLogin={handleLogin} />
            ) : (
                <MainLayout
                    user={user}
                    onLogout={handleLogout}
                    currentPage={currentPage}
                    onNavigate={setCurrentPage}
                    posLines={posLines}
                    setPosLines={setPosLines}
                />
            )}
        </SettingsProvider>
    );
}

export default App;
