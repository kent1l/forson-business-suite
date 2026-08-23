/**
 * Legacy compatibility wrapper for ExpenseAIParser.
 * Delegates calls to services/ai/features/expenseParserAI.js.
 */
const { expenseParserAI } = require('./ai');

async function parseExpenseText(text, clarifyingContext = null) {
    return expenseParserAI.parseExpenseText(text, clarifyingContext);
}

module.exports = { parseExpenseText };
