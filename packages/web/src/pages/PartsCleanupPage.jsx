import { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import DuplicateGroupList from '../components/parts-cleanup/DuplicateGroupList';
import PartCompareCard from '../components/parts-cleanup/PartCompareCard';
import ConflictResolver from '../components/parts-cleanup/ConflictResolver';
import ImpactSummary from '../components/parts-cleanup/ImpactSummary';
import ConfirmMerge from '../components/parts-cleanup/ConfirmMerge';

const STEPS = {
    FIND_DUPLICATES: 'find_duplicates',
    CHOOSE_CANONICAL: 'choose_canonical',
    RESOLVE_CONFLICTS: 'resolve_conflicts',
    PREVIEW_IMPACT: 'preview_impact',
    CONFIRM_MERGE: 'confirm_merge'
};

const STEP_TITLES = {
    [STEPS.FIND_DUPLICATES]: 'Find Duplicates',
    [STEPS.CHOOSE_CANONICAL]: 'Choose Parts to Keep',
    [STEPS.RESOLVE_CONFLICTS]: 'Resolve Conflicts',
    [STEPS.PREVIEW_IMPACT]: 'Preview Impact',
    [STEPS.CONFIRM_MERGE]: 'Confirm Merge'
};

const PartsCleanupPage = ({ user: _user, onNavigate }) => {
    const { hasPermission } = useAuth();
    
    // Redirect if no permission
    useEffect(() => {
        if (!hasPermission('parts:merge')) {
            onNavigate('parts');
            toast.error('You do not have permission to access the parts cleanup feature');
        }
    }, [hasPermission, onNavigate]);

    // State management
    const [currentStep, setCurrentStep] = useState(STEPS.FIND_DUPLICATES);
    const [selectedDuplicateGroups, setSelectedDuplicateGroups] = useState([]);
    const [keepParts, setKeepParts] = useState({});
    const [mergeRules, setMergeRules] = useState({
        mergePartNumbers: true,
        mergeApplications: true,
        preserveHistory: true,
        fieldOverrides: {}
    });
    const [mergePreview, setMergePreview] = useState(null);
    const [loading, setLoading] = useState(false);

    // Step navigation helpers
    const stepOrder = [
        STEPS.FIND_DUPLICATES,
        STEPS.CHOOSE_CANONICAL,
        STEPS.RESOLVE_CONFLICTS,
        STEPS.PREVIEW_IMPACT,
        STEPS.CONFIRM_MERGE
    ];

    const getStepNumber = (step) => {
        return stepOrder.indexOf(step) + 1;
    };

    const canGoNext = () => {
        switch (currentStep) {
            case STEPS.FIND_DUPLICATES:
                return selectedDuplicateGroups.length > 0;
            case STEPS.CHOOSE_CANONICAL:
                return Object.keys(keepParts).length === selectedDuplicateGroups.length;
            case STEPS.RESOLVE_CONFLICTS:
                return true; // Always can proceed from conflict resolution
            case STEPS.PREVIEW_IMPACT:
                return mergePreview !== null;
            default:
                return false;
        }
    };

    const canGoPrevious = () => {
        return currentStep !== STEPS.FIND_DUPLICATES;
    };

    const goNext = () => {
        if (currentStep === STEPS.RESOLVE_CONFLICTS) {
            generateMergePreview();
        }
        
        const currentIndex = stepOrder.indexOf(currentStep);
        if (currentIndex < stepOrder.length - 1) {
            setCurrentStep(stepOrder[currentIndex + 1]);
        }
    };

    const goPrevious = () => {
        const currentIndex = stepOrder.indexOf(currentStep);
        if (currentIndex > 0) {
            setCurrentStep(stepOrder[currentIndex - 1]);
        }
    };

    // API calls
    const generateMergePreview = async () => {
        setLoading(true);
        try {
            const previews = [];
            
            for (const group of selectedDuplicateGroups) {
                if (!keepParts[group.groupId]) {
                    // Skip groups where no keep part is selected
                    continue;
                }
                
                const sourcePartIds = group.parts
                    .filter(p => p.part_id !== keepParts[group.groupId]?.part_id)
                    .map(p => p.part_id);
                
                if (sourcePartIds.length > 0) {
                    const response = await api.post('/parts/merge/merge-preview', {
                        keepPartId: keepParts[group.groupId]?.part_id,
                        mergePartIds: sourcePartIds,
                        rules: mergeRules
                    });
                    
                    const keepPart = keepParts[group.groupId];
                    const mergeParts = group.parts.filter(p => p.part_id !== keepPart?.part_id);
                    
                    previews.push({
                        groupId: group.groupId,
                        sourcePartIds,
                        targetPartId: keepParts[group.groupId]?.part_id,
                        keepPart,
                        mergeParts,
                        ...response.data
                    });
                }
            }
            
            setMergePreview(previews);
        } catch (error) {
            console.error('Error generating merge preview:', error);
            toast.error('Failed to generate merge preview: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    };

    const executeMerge = async () => {
        setLoading(true);
        try {
            const results = [];
            
            for (const group of selectedDuplicateGroups) {
                if (!keepParts[group.groupId]) {
                    continue;
                }
                
                const sourcePartIds = group.parts
                    .filter(p => p.part_id !== keepParts[group.groupId]?.part_id)
                    .map(p => p.part_id);
                
                const mergeData = {
                    targetPartId: keepParts[group.groupId]?.part_id,
                    sourcePartIds: sourcePartIds,
                    conflictResolutions: mergeRules,
                    mergeNotes: '',
                    preserveAliases: true
                };

                const response = await api.post('/parts/merge/merge', mergeData);
                results.push(response.data);
            }
            
            toast.success(`Successfully merged ${results.length} groups of parts!`);
            onNavigate('parts');
        } catch (error) {
            console.error('Error executing merge:', error);
            toast.error('Failed to execute merge: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case STEPS.FIND_DUPLICATES:
                return (
                    <DuplicateGroupList
                        selectedGroups={selectedDuplicateGroups}
                        onSelectionChange={setSelectedDuplicateGroups}
                    />
                );
            
            case STEPS.CHOOSE_CANONICAL:
                return (
                    <div className="space-y-6">
                        {selectedDuplicateGroups.map(group => (
                            <div key={group.groupId} className="bg-white rounded-lg border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold mb-4">
                                    Group: {group.reasons.join(', ')} (Score: {group.score.toFixed(2)})
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {group.parts.map(part => (
                                        <PartCompareCard
                                            key={part.part_id}
                                            part={part}
                                            isSelected={keepParts[group.groupId]?.part_id === part.part_id}
                                            onSelect={() => setKeepParts(prev => ({
                                                ...prev,
                                                [group.groupId]: part
                                            }))}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            
            case STEPS.RESOLVE_CONFLICTS:
                return (
                    <ConflictResolver
                        selectedGroups={selectedDuplicateGroups}
                        keepParts={keepParts}
                        rules={mergeRules}
                        onRulesChange={setMergeRules}
                    />
                );
            
            case STEPS.PREVIEW_IMPACT:
                return (
                    <ImpactSummary
                        mergePreview={mergePreview}
                        loading={loading}
                    />
                );
            
            case STEPS.CONFIRM_MERGE:
                return (
                    <ConfirmMerge
                        mergePreview={mergePreview}
                        onConfirm={executeMerge}
                        loading={loading}
                    />
                );
            
            default:
                return <div>Unknown step</div>;
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <div className="flex justify-between items-center">
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
                        <Icon path={ICONS.x} className="h-5 w-5" />
                        <span>Cancel</span>
                    </button>
                </div>
            </div>

            {/* Step Indicator */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <div className="flex items-center justify-between">
                    {Object.entries(STEP_TITLES).map(([stepValue, stepTitle], index) => {
                        const isActive = currentStep === stepValue;
                        const isCompleted = Object.values(STEPS).indexOf(currentStep) > index;
                        const stepNumber = index + 1;

                        return (
                            <div key={stepValue} className="flex items-center">
                                <div className={`
                                    flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold
                                    ${isActive 
                                        ? 'bg-blue-600 text-white' 
                                        : isCompleted 
                                            ? 'bg-green-600 text-white' 
                                            : 'bg-gray-200 text-gray-600'
                                    }
                                `}>
                                    {isCompleted ? '✓' : stepNumber}
                                </div>
                                <div className="ml-3">
                                    <div className={`text-sm font-medium ${isActive ? 'text-blue-600' : 'text-gray-900'}`}>
                                        {stepTitle}
                                    </div>
                                </div>
                                {index < Object.keys(STEP_TITLES).length - 1 && (
                                    <div className={`flex-1 h-0.5 mx-4 ${isCompleted ? 'bg-green-600' : 'bg-gray-200'}`} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Content */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                {renderStepContent()}
            </div>

            {/* Navigation */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex justify-between items-center">
                    <button
                        onClick={goPrevious}
                        disabled={!canGoPrevious()}
                        className={`
                            px-4 py-2 rounded-lg font-semibold flex items-center space-x-2
                            ${canGoPrevious() 
                                ? 'text-gray-700 bg-gray-100 hover:bg-gray-200' 
                                : 'text-gray-400 bg-gray-50 cursor-not-allowed'
                            }
                        `}
                    >
                        <Icon path={ICONS.chevronLeft} className="h-4 w-4" />
                        <span>Previous</span>
                    </button>

                    <div className="text-sm text-gray-500">
                        Step {getStepNumber(currentStep)} of {Object.keys(STEPS).length}
                    </div>

                    {currentStep !== STEPS.CONFIRM_MERGE ? (
                        <button
                            onClick={goNext}
                            disabled={!canGoNext() || loading}
                            className={`
                                px-4 py-2 rounded-lg font-semibold flex items-center space-x-2
                                ${canGoNext() && !loading
                                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }
                            `}
                        >
                            <span>{loading ? 'Loading...' : 'Next'}</span>
                            <Icon path={ICONS.chevronRight} className="h-4 w-4" />
                        </button>
                    ) : (
                        <div className="text-sm text-gray-500">
                            Use the confirmation button above to proceed
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PartsCleanupPage;
