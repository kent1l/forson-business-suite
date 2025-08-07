import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    // Check for a saved session when the app loads
    useEffect(() => {
        const sessionData = localStorage.getItem('userSession');
        if (sessionData) {
            const parsedData = JSON.parse(sessionData);
            // Set the user state to the user object from the session
            setUser(parsedData.user);
        }
    }, []);

    const handleLogin = (loginData) => {
        // loginData from the API is { user: {...}, token: '...' }
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
        <>
            <Toaster position="top-center" /> 
            <MainLayout
                user={user}
                onLogout={handleLogout}
                currentPage={currentPage}
                onNavigate={setCurrentPage}
            />
        </>
    );
}

export default App;
