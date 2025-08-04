import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast'; // 1. Import the Toaster
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    if (!user) {
        return (
            <>
                <Toaster position="top-center" /> 
                <LoginScreen onLogin={setUser} />
            </>
        );
    }

    return (
        <>
            <Toaster position="top-center" /> 
            <MainLayout
                user={user}
                onLogout={() => setUser(null)}
                currentPage={currentPage}
                onNavigate={setCurrentPage}
            />
        </>
    );
}

export default App;
