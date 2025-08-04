import React, { useState, useEffect } from 'react';
import axios from 'axios';

// --- SVG ICONS (self-contained for portability) ---
const Icon = ({ path, className = "h-6 w-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

const ICONS = {
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  password: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  dashboard: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  suppliers: "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-2h8a1 1 0 001-1z",
  parts: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  logout: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  menu: "M4 6h16M4 12h16M4 18h16",
  box: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  warning: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  truck: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M9 11a1 1 0 100-2 1 1 0 000 2z",
};

// --- PAGE COMPONENTS ---

const DashboardCard = ({ title, value, icon, color }) => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 flex items-center space-x-4 transition-all hover:shadow-md hover:-translate-y-1">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
            <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
        </div>
        <div>
            <h3 className="text-sm font-medium text-gray-500">{title}</h3>
            <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
        </div>
    </div>
);

const Dashboard = () => {
    const stats = {
        totalParts: 1250,
        lowStockItems: 15,
        pendingOrders: 4,
    };

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Dashboard</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <DashboardCard title="Total Parts" value={stats.totalParts.toLocaleString()} icon={ICONS.box} color={{bg: 'bg-blue-100', text: 'text-blue-600'}} />
                <DashboardCard title="Low Stock Items" value={stats.lowStockItems} icon={ICONS.warning} color={{bg: 'bg-yellow-100', text: 'text-yellow-600'}} />
                <DashboardCard title="Pending Orders" value={stats.pendingOrders} icon={ICONS.truck} color={{bg: 'bg-red-100', text: 'text-red-600'}} />
            </div>
        </div>
    );
};

const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchSuppliers = async () => {
            try {
                setError('');
                setLoading(true);
                const response = await axios.get('http://localhost:3001/api/suppliers');
                setSuppliers(response.data);
            } catch (err) {
                setError('Failed to fetch suppliers.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchSuppliers();
    }, []); // The empty array means this effect runs only once when the component mounts

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Suppliers</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading suppliers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">ID</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Contact Person</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Phone</th>
                            </tr>
                        </thead>
                        <tbody>
                            {suppliers.map(supplier => (
                                <tr key={supplier.supplier_id} className="border-b hover:bg-gray-50">
                                    <td className="p-3 text-sm">{supplier.supplier_id}</td>
                                    <td className="p-3 text-sm font-medium text-gray-800">{supplier.supplier_name}</td>
                                    <td className="p-3 text-sm">{supplier.contact_person}</td>
                                    <td className="p-3 text-sm">{supplier.phone}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

const PartsPage = () => <h1 className="text-2xl font-semibold text-gray-800">Parts</h1>;


// --- LAYOUT COMPONENT ---

const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const navItems = [
        { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard' },
        { name: 'Suppliers', icon: ICONS.suppliers, page: 'suppliers' },
        { name: 'Parts', icon: ICONS.parts, page: 'parts' },
    ];

    return (
        <>
            <div
                className={`fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden ${isOpen ? 'block' : 'hidden'}`}
                onClick={() => setIsOpen(false)}
            ></div>
            <div className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col z-30 w-64 md:w-60 md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center px-6 text-lg font-bold text-blue-600">
                    Forson Suite
                </div>
                <nav className="flex-1 px-4 py-4 space-y-1">
                    {navItems.map(item => (
                        <a
                            key={item.name}
                            href="#"
                            onClick={(e) => { e.preventDefault(); onNavigate(item.page); setIsOpen(false); }}
                            className={`flex items-center px-3 py-2.5 rounded-lg transition-colors duration-200 text-sm font-medium ${currentPage === item.page ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            <Icon path={item.icon} className="h-5 w-5" />
                            <span className="ml-3">{item.name}</span>
                        </a>
                    ))}
                </nav>
            </div>
        </>
    );
};

const Header = ({ user, onLogout, onMenuClick }) => {
    const getInitials = (name) => {
        if (!name) return '';
        const names = name.split(' ');
        if (names.length > 1) {
            return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
        }
        return name[0].toUpperCase();
    }

    return (
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6">
            <button onClick={onMenuClick} className="md:hidden text-gray-600 hover:text-gray-800">
                <Icon path={ICONS.menu} />
            </button>
            <div className="flex-1"></div>
            <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold mr-3">
                    {getInitials(user.first_name + ' ' + user.last_name)}
                </div>
                <span className="hidden sm:inline text-sm text-gray-600 mr-4">Welcome, <strong>{user.first_name}</strong></span>
                <button onClick={onLogout} className="text-gray-500 hover:text-red-600 transition">
                    <Icon path={ICONS.logout} className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
};

const MainLayout = ({ user, onLogout, onNavigate, currentPage }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <Dashboard />;
            case 'suppliers': return <SuppliersPage />;
            case 'parts': return <PartsPage />;
            default: return <Dashboard />;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-gray-800">
            <Sidebar onNavigate={onNavigate} currentPage={currentPage} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header user={user} onLogout={onLogout} onMenuClick={() => setSidebarOpen(true)} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 sm:p-6 md:p-8">
                    {renderPage()}
                </main>
            </div>
        </div>
    );
};


// --- LOGIN COMPONENT ---

const LoginScreen = ({ onLogin }) => {
    const [username, setUsername] = useState('kent.pilar');
    const [password, setPassword] = useState('password123');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await axios.post('http://localhost:3001/api/login', { username, password });
            onLogin(response.data.user);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen flex items-center justify-center font-sans p-4">
            <div className="w-full max-w-sm">
                 <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Forson Business Suite</h1>
                    <p className="text-gray-500 mt-1">Please sign in to continue</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-8">
                    <form onSubmit={handleLogin}>
                        <div className="mb-4">
                             <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.user} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="text"
                                    placeholder="e.g. kent.pilar"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                        <div className="mb-6">
                             <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.password} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                        {error && <p className="text-red-500 text-xs text-center mb-4">{error}</p>}
                        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition duration-300 font-semibold disabled:bg-blue-400">
                            {loading ? 'Signing In...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    // If there's no user, show the login screen
    if (!user) {
        return <LoginScreen onLogin={setUser} />;
    }

    // If a user is logged in, show the main application layout
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
