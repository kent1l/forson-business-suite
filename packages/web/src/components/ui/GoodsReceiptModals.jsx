import Modal from './Modal';
import SupplierForm from '../forms/SupplierForm';
import PartForm from '../forms/PartForm';
import PartApplicationManager from '../../pages/PartApplicationManager';

const GoodsReceiptModals = ({
    // Modal states
    isSupplierModalOpen,
    isNewPartModalOpen,
    isEditPartModalOpen,
    isAppModalOpen,

    // Modal state setters
    setIsSupplierModalOpen,
    setIsEditPartModalOpen,
    setIsNewPartModalOpen,
    setIsAppModalOpen,
    setCurrentEditPart,
    setCurrentPart,

    // Data props
    brands,
    groups,
    currentPart,
    currentEditPart,

    // Handler functions
    handleNewSupplierSave,
    handleSaveNewPart,
    handleEditPartSave,
    handleAppManagerClose,
    fetchInitialData,
    onBrandGroupAdded = fetchInitialData,

    // State updaters for lines (intentionally unused for now)
    _setLines,
    _lines
}) => {
    const lookupRefresh = onBrandGroupAdded || fetchInitialData;
    return (
        <>
            <Modal isOpen={isSupplierModalOpen} onClose={() => setIsSupplierModalOpen(false)} title="Add New Supplier">
                <SupplierForm onSave={handleNewSupplierSave} onCancel={() => setIsSupplierModalOpen(false)} />
            </Modal>

            <Modal isOpen={isNewPartModalOpen} onClose={() => setIsNewPartModalOpen(false)} title="Add New Part">
                <PartForm
                    brands={brands}
                    groups={groups}
                    onSave={handleSaveNewPart}
                    onCancel={() => setIsNewPartModalOpen(false)}
                    onBrandGroupAdded={lookupRefresh}
                />
            </Modal>

            <Modal isOpen={isEditPartModalOpen} onClose={() => { setIsEditPartModalOpen(false); setCurrentEditPart(null); }} title="Edit Part">
                {currentEditPart && (
                    <PartForm
                        part={currentEditPart}
                        brands={brands}
                        groups={groups}
                        onSave={handleEditPartSave}
                        onCancel={() => { setIsEditPartModalOpen(false); setCurrentEditPart(null); }}
                        onBrandGroupAdded={lookupRefresh}
                    />
                )}
            </Modal>

            <Modal isOpen={isAppModalOpen} onClose={handleAppManagerClose} title={`Manage Applications for: ${currentPart?.internal_sku || currentPart?.display_name || currentPart?.detail || ''}`}>
                <PartApplicationManager part={currentPart} onCancel={handleAppManagerClose} />
            </Modal>
        </>
    );
};

export default GoodsReceiptModals;
