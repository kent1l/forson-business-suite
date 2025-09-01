const pdf = require('pdf-creator-node');
const fs = require('fs');
const path = require('path');

const generatePurchaseOrderPDF = async (poData, linesData) => {
    const templatePath = path.join(__dirname, '../../templates/pdf/purchase-order.html');
    const html = fs.readFileSync(templatePath, 'utf8');

    const options = { format: 'A4', orientation: 'portrait', border: '10mm' };

    let totalAmount = 0;
    const lines = linesData.map((line) => {
        const subtotal = Number(line.quantity) * Number(line.cost_price);
        totalAmount += subtotal;
        return {
            ...line,
            cost_price_formatted: parseFloat(line.cost_price).toFixed(2),
            subtotal_formatted: subtotal.toFixed(2),
        };
    });

    const po = {
        ...poData,
        order_date: poData.order_date ? new Date(poData.order_date).toLocaleDateString() : '',
        expected_date: poData.expected_date ? new Date(poData.expected_date).toLocaleDateString() : '',
    };

    const document = {
        html,
        data: { po, lines, totalAmount: totalAmount.toFixed(2) },
        path: path.join(process.cwd(), `output_${po.po_number}.pdf`),
        type: '',
    };

    try {
        const res = await pdf.create(document, options);
        return res.filename;
    } catch (error) {
        console.error('PDF Generation Error:', error);
        throw error;
    }
};

module.exports = { generatePurchaseOrderPDF };
