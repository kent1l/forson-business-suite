const fs = require('fs');
let code = fs.readFileSync('packages/web/src/pages/SettingsPage.jsx', 'utf8');

const cycleCountSettings = `
const CycleCountSettings = ({ settings, handleChange }) => (
    <div className="space-y-4">
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Enable Cycle Counting</label>
            <div className="mt-2 flex items-center">
                <input
                    type="checkbox"
                    name="CYCLE_COUNT_ENABLED"
                    checked={settings.CYCLE_COUNT_ENABLED === 'true'}
                    onChange={(e) => handleChange({ target: { name: 'CYCLE_COUNT_ENABLED', value: e.target.checked ? 'true' : 'false' } })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-600">Turn on automated nightly task generation</span>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule (CRON format)</label>
                <input type="text" name="CYCLE_COUNT_SCHEDULE" value={settings.CYCLE_COUNT_SCHEDULE || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="0 2 * * *" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Items Per Batch</label>
                <input type="number" name="CYCLE_COUNT_BATCH_SIZE" value={settings.CYCLE_COUNT_BATCH_SIZE || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points per day uncounted</label>
                <input type="number" name="CYCLE_COUNT_UNCOUNTED_WEIGHT" value={settings.CYCLE_COUNT_UNCOUNTED_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points per sale (30d)</label>
                <input type="number" name="CYCLE_COUNT_VELOCITY_WEIGHT" value={settings.CYCLE_COUNT_VELOCITY_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points for negative stock</label>
                <input type="number" name="CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT" value={settings.CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
        </div>
    </div>
);
`;

code = code.replace('const TaxRateSettings', cycleCountSettings + '\nconst TaxRateSettings');

const navCode = `                                <button type="button" onClick={() => setActiveTab('payment_methods')} className={\`py-3 px-1 border-b-2 font-medium text-sm \${activeTab === 'payment_methods' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}\`}>Payment Methods</button>
                                <button type="button" onClick={() => setActiveTab('cycle_count')} className={\`py-3 px-1 border-b-2 font-medium text-sm \${activeTab === 'cycle_count' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}\`}>Cycle Count</button>`;

code = code.replace(/<button type="button" onClick=\{\(\) => setActiveTab\('payment_methods'\)\}.*?<\/button>/g, navCode);

const tabCode = `                        {activeTab === 'payment_methods' && <PaymentMethodSettings />}
                        {activeTab === 'cycle_count' && <CycleCountSettings settings={settings} handleChange={handleChange} />}`;

code = code.replace(/\{activeTab === 'payment_methods' && <PaymentMethodSettings \/>\}/g, tabCode);

fs.writeFileSync('packages/web/src/pages/SettingsPage.jsx', code);
