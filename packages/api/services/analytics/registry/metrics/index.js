const { SALES_METRICS } = require('./sales');
const { MARGIN_METRICS } = require('./margin');
const { INVENTORY_METRICS } = require('./inventory');
const { AR_METRICS } = require('./ar');
const { FINANCE_METRICS } = require('./finance');
const { QUALITY_METRICS } = require('./quality');
const { CUSTOMER_METRICS } = require('./customers');

// One flat id -> metric map. Files are a filing convention only; ids are the
// wire contract and must be unique across all of them, which registry/index.js
// asserts at load.
const METRIC_SOURCE_FILES = [
    ['sales', SALES_METRICS],
    ['margin', MARGIN_METRICS],
    ['inventory', INVENTORY_METRICS],
    ['ar', AR_METRICS],
    ['finance', FINANCE_METRICS],
    ['quality', QUALITY_METRICS],
    ['customers', CUSTOMER_METRICS],
];

module.exports = { METRIC_SOURCE_FILES };
