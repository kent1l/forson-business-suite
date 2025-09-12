const PartsCleanupPage = ({ user: _user, onNavigate }) => {
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-white rounded-lg shadow">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Parts Cleanup</h1>
                            <p className="text-gray-600 mt-1">
                                Merge duplicate parts to clean up your database. This operation cannot be easily undone.
                            </p>
                        </div>
                        <button
                            onClick={() => onNavigate('parts')}
                            className="text-gray-600 hover:text-gray-800 flex items-center space-x-2"
                        >
                            <span>✕</span>
                            <span>Cancel</span>
                        </button>
                    </div>
                    
                    <div className="text-center py-12">
                        <h2 className="text-xl font-semibold mb-4">Parts Cleanup Feature</h2>
                        <p className="text-gray-600 mb-4">
                            This feature is under development. The database migrations and backend services are ready!
                        </p>
                        <p className="text-gray-600 mb-4">
                            Backend features available:
                        </p>
                        <ul className="text-left max-w-md mx-auto text-gray-600 mb-6">
                            <li>• Duplicate detection algorithms ✅</li>
                            <li>• Part merge services ✅</li>
                            <li>• API endpoints ✅</li>
                            <li>• Database migrations ✅</li>
                            <li>• Permission system ✅</li>
                        </ul>
                        <button
                            onClick={() => onNavigate('parts')}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                        >
                            Back to Parts
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PartsCleanupPage;
