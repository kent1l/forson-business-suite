// Test the receipt number formatter
const { formatPhysicalReceiptNumber } = require('./helpers/receiptNumberFormatter');

console.log('Testing receipt number formatting:');
console.log('Input: "  si 1234  " -> Output:', formatPhysicalReceiptNumber('  si 1234  '));
console.log('Input: "ABC/5678" -> Output:', formatPhysicalReceiptNumber('ABC/5678'));
console.log('Input: "xyz 9999" -> Output:', formatPhysicalReceiptNumber('xyz 9999'));
console.log('Input: "SI1234" -> Output:', formatPhysicalReceiptNumber('SI1234'));
console.log('Input: "" -> Output:', formatPhysicalReceiptNumber(''));
console.log('Input: null -> Output:', formatPhysicalReceiptNumber(null));
