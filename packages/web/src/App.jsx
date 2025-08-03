import React, { useState } from 'react';
import axios from 'axios';

// --- ICONS (using inline SVG for portability) ---
const UserIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
const PasswordIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;


function App() {
  // State to hold the logged-in user's data
  const [user, setUser] = useState(null);

  // State for the form inputs
  const [username, setUsername] = useState('kent.pilar');
  const [password, setPassword] = useState('password123');

  // State for loading and error messages
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Function to handle form submission
  const handleLogin = async (e) => {
    e.preventDefault(); // Prevent the form from reloading the page
    setError('');
    setLoading(true);

    try {
      // Make the POST request to your backend's login endpoint
      const response = await axios.post('http://localhost:3001/api/login', {
        username: username,
        password: password,
      });

      // If login is successful, store the user data
      setUser(response.data.user);
      console.log('Login successful:', response.data);

    } catch (err) {
      // If there's an error, display the message from the API
      if (err.response && err.response.data) {
        setError(err.response.data.message);
      } else {
        setError('Login failed. Please try again.');
      }
      console.error('Login error:', err);
    } finally {
      setLoading(false); // Stop the loading indicator
    }
  };

  // If the user is logged in, show a welcome message
  if (user) {
    return (
      <div className="bg-gray-100 min-h-screen flex items-center justify-center text-center p-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Welcome, {user.first_name}!</h1>
          <p className="text-gray-600 mt-2">You have successfully logged in.</p>
          <button
            onClick={() => setUser(null)}
            className="mt-6 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  // If no user is logged in, show the login form
  return (
    <div className="bg-gray-100 min-h-screen flex items-center justify-center font-sans">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-700">Forson Business Suite</h1>
          <p className="text-gray-500">Please sign in to continue</p>
        </div>
        <form onSubmit={handleLogin}>
          <div className="mb-4 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <UserIcon />
            </div>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 pl-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="mb-6 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <PasswordIcon />
            </div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 pl-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition duration-300 font-semibold disabled:bg-blue-300"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
