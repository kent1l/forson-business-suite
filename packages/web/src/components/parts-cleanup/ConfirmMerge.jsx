import { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const ConfirmMerge = ({ mergePreview, onConfirm, loading }) => {
    const [confirmationText, setConfirmationText] = useState('');
    const [agreed, setAgreed] = useState(false);

    const isConfirmationValid = confirmationText === 'MERGE' && agreed;

    const handleConfirm = () => {
        if (isConfirmationValid && !loading) {
            onConfirm();
        }
    };

    if (!mergePreview || mergePreview.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="text-gray-500">No merge preview available</div>
            </div>
        );
    }

    const totalGroups = mergePreview.length;
    const totalPartsToMerge = mergePreview.reduce((sum, item) => sum + item.mergeParts.length, 0);

    return (
        <div className="space-y-6">
            {/* Final Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Ready to Execute Merge</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="text-xl font-bold text-blue-700">
                            {totalGroups}
                        </div>
                        <div className="text-sm text-blue-600">Groups will be merged</div>
                    </div>
                    
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="text-xl font-bold text-red-700">
                            {totalPartsToMerge}
                        </div>
                        <div className="text-sm text-red-600">Parts will be deactivated</div>
                    </div>
                </div>

                {/* Quick review of what will happen */}
                <div className="space-y-3">
                    {mergePreview.map((item, index) => (
                        <div key={index} className="border border-gray-100 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-green-700">
                                        Keep: {item.keepPart.display_name}
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono">
                                        {item.keepPart.internal_sku}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-400">
                                    Merging {item.mergeParts.length} part{item.mergeParts.length !== 1 ? 's' : ''}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Final Warnings */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <div className="flex items-start">
                    <Icon path={ICONS.warning} className="h-6 w-6 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                        <h3 className="text-md font-semibold text-red-800 mb-2">
                            Critical Warning - Please Read Carefully
                        </h3>
                        <div className="text-red-700 text-sm space-y-2">
                            <p><strong>This operation cannot be easily reversed.</strong></p>
                            <p>When you proceed:</p>
                            <ul className="list-disc list-inside ml-4 space-y-1">
                                <li>{totalPartsToMerge} parts will be marked as inactive and their SKUs modified</li>
                                <li>All references (orders, invoices, receipts, etc.) will be redirected to the kept parts</li>
                                <li>Inventory will be consolidated and WAC will be recalculated</li>
                                <li>Part numbers and applications will be merged</li>
                                <li>The operation will be logged for audit purposes</li>
                            </ul>
                            <p className="font-medium mt-3">
                                Ensure you have a recent database backup before proceeding.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Confirmation Form */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-md font-semibold mb-4">Confirmation Required</h3>
                
                <div className="space-y-4">
                    {/* Checkbox agreement */}
                    <label className="flex items-start">
                        <input
                            type="checkbox"
                            checked={agreed}
                            onChange={(e) => setAgreed(e.target.checked)}
                            className="mt-1 mr-3"
                        />
                        <div className="text-sm">
                            <div className="font-medium">I understand the consequences of this action</div>
                            <div className="text-gray-600">
                                I acknowledge that this merge operation cannot be easily undone and that I have 
                                reviewed the impact summary. I confirm that I have appropriate database backups.
                            </div>
                        </div>
                    </label>

                    {/* Text confirmation */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Type "MERGE" to confirm (case sensitive):
                        </label>
                        <input
                            type="text"
                            value={confirmationText}
                            onChange={(e) => setConfirmationText(e.target.value)}
                            placeholder="Type MERGE here"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            disabled={loading}
                        />
                    </div>
                </div>
            </div>

            {/* Confirm Button */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                        {!agreed && 'Please agree to the terms first'}
                        {agreed && confirmationText !== 'MERGE' && 'Please type "MERGE" to continue'}
                        {isConfirmationValid && !loading && 'Ready to execute merge operation'}
                        {loading && 'Executing merge operation...'}
                    </div>
                    
                    <button
                        onClick={handleConfirm}
                        disabled={!isConfirmationValid || loading}
                        className={`
                            px-6 py-3 rounded-lg font-semibold flex items-center space-x-2
                            ${isConfirmationValid && !loading
                                ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500' 
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }
                        `}
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Merging...</span>
                            </>
                        ) : (
                            <>
                                <Icon path={ICONS.check} className="h-4 w-4" />
                                <span>Execute Merge</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Progress indicator when loading */}
            {loading && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                    <div className="flex items-center">
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-3"></div>
                        <div>
                            <div className="text-blue-800 font-medium">Merge in progress...</div>
                            <div className="text-blue-600 text-sm">
                                This may take several minutes for large operations. Please do not close this page.
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConfirmMerge;
