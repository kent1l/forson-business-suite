import React, { useState } from 'react';
import LoginScreen from './pages/LoginScreen';
import MainLayout from './components/layout/MainLayout';

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    if (!user) {
        return <LoginScreen onLogin={setUser} />;
    }

    return (
        <MainLayout
            user={user}
            onLogout={() => setUser(null)}
            currentPage={currentPage}
            onNavigate={setCurrentPage}
        />
    );
}

export default App;