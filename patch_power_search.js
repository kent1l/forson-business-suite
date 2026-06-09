const fs = require('fs');
let code = fs.readFileSync('packages/web/src/pages/PowerSearchPage.jsx', 'utf8');

const requestAuditCode = `
                        <div className="pt-4 border-t border-gray-200 mt-4">
                            <button
                                onClick={async () => {
                                    try {
                                        await api.post('/inventory/cycle-count/request-audit', { part_id: selectedPartDetail.part_id });
                                        toast.success('Inventory audit requested for ' + selectedPartDetail.internal_sku);
                                    } catch (err) {
                                        toast.error('Failed to request audit');
                                    }
                                }}
                                className="px-4 py-2 bg-yellow-50 text-yellow-600 border border-yellow-200 hover:bg-yellow-100 rounded text-sm font-medium transition-colors"
                            >
                                Request Inventory Audit
                            </button>
                        </div>
                    </div>
`;

code = code.replace(/<\/div>\s*<\/div>\s*\)\}\s*<\/Modal>/, requestAuditCode + '\n                )}\n            </Modal>');

fs.writeFileSync('packages/web/src/pages/PowerSearchPage.jsx', code);
