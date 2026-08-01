/**
 * Legacy compatibility wrapper for ExpenseAIParser.
 * Delegates calls to services/ai/features/expenseParserAI.js.
 */
const { expenseParserAI } = require('./ai');

async function parseExpenseText(text) {
    return expenseParserAI.parseExpenseText(text);
}

module.exports = { parseExpenseText };
