'use strict';

const cron = require('node-cron');
const db = require('../db');
const notifications = require('./notificationService');
const analytics = require('./analytics');
const { METRICS, FORMATS } = require('./analytics/registry');
const { INSIGHT_RULES } = require('./analytics/registry/insights');
const { manilaDateString } = require('../helpers/manilaDate');

let alertCronJob = null;
let digestCronJob = null;

/**
 * Formats a value slot according to registry formats.
 */
function formatSlot(slot) {
    if (!slot) return '';
    const value = slot.value;
    if (value === null || value === undefined) return 'No data';

    let formatId = slot.format;
    if (!formatId && slot.metric && METRICS[slot.metric]) {
        formatId = METRICS[slot.metric].format;
    }
    const fmt = FORMATS[formatId] || FORMATS.text;
    if (!fmt.numeric || typeof value !== 'number') {
        return String(value);
    }

    const abs = Math.abs(value);
    let str;
    if (fmt.compactable && abs >= 1_000_000) {
        str = `${(value / 1_000_000).toFixed(2)}M`;
    } else if (fmt.compactable && abs >= 1_000) {
        str = `${(value / 1_000).toFixed(1)}k`;
    } else {
        str = value.toLocaleString('en-US', {
            minimumFractionDigits: fmt.decimals,
            maximumFractionDigits: fmt.decimals,
        });
    }

    return `${fmt.prefix}${str}${fmt.suffix}`;
}

/**
 * Formats an insight template by replacing placeholders with formatted slot values.
 */
function formatInsightSentence(template, values) {
    if (!template) return '';
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        if (values && values[key]) {
            return formatSlot(values[key]);
        }
        return match;
    });
}

function titleForInsight(insight) {
    const rawName = (insight.id || 'insight').replace(/^insight\./, '').replace(/_/g, ' ');
    const capitalised = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${capitalised} ${insight.severity === 'critical' ? 'Alert' : 'Notice'}`;
}

/**
 * Daily scan that evaluates insight rules and raises in-app notifications
 * for critical and warning conditions.
 */
async function runAnalyticsAlertScan() {
    console.log('[AnalyticsAlertService] Starting analytics insight alert scan...');
    try {
        const { rows: settingsRows } = await db.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'ANALYTICS_ALERTS_ENABLED'"
        );
        if (settingsRows.length > 0 && settingsRows[0].setting_value === 'false') {
            console.log('[AnalyticsAlertService] Analytics alerts are disabled via settings.');
            return { fired: 0, skipped: true };
        }

        const today = manilaDateString();
        const systemReq = {
            user: {
                employee_id: null,
                permission_level_id: 10,
                permissions: ['analytics:view', 'analytics:financials', 'analytics:export'],
            },
        };

        const boardsToCheck = ['overview', 'inventory', 'profitability', 'receivables', 'purchasing', 'operations', 'customers'];
        const seenRuleIds = new Set();
        let emittedCount = 0;

        for (const boardId of boardsToCheck) {
            try {
                const result = await analytics.getInsights({
                    boardId,
                    dateRange: { preset: 'last_30_days' },
                    compare: true,
                }, systemReq);

                if (result && Array.isArray(result.insights)) {
                    for (const insight of result.insights) {
                        if (seenRuleIds.has(insight.id)) continue;
                        seenRuleIds.add(insight.id);

                        if (insight.severity !== 'critical' && insight.severity !== 'warning') {
                            continue;
                        }

                        const bodyText = formatInsightSentence(insight.template, insight.values);
                        const rule = INSIGHT_RULES[insight.id];
                        const targetBoard = (rule && rule.boards && rule.boards[0]) || boardId;
                        const category = (targetBoard === 'inventory' || targetBoard === 'operations' || targetBoard === 'purchasing')
                            ? 'inventory'
                            : 'finance';

                        await notifications.emitSafe({
                            type: 'analytics.insight',
                            category,
                            severity: insight.severity,
                            title: titleForInsight(insight),
                            body: bodyText,
                            linkPage: 'analytics',
                            linkState: {
                                boardId: targetBoard,
                                preset: 'last_30_days',
                            },
                            requiredPermission: 'analytics:view',
                            dedupeKey: `analytics.insight:${insight.id}:${today}`,
                        });
                        emittedCount += 1;
                    }
                }
            } catch (err) {
                console.warn(`[AnalyticsAlertService] Failed evaluating insights for board '${boardId}':`, err.message);
            }
        }

        console.log(`[AnalyticsAlertService] Scan complete. Emitted/checked ${emittedCount} insight alert(s).`);
        return { fired: emittedCount, skipped: false };
    } catch (err) {
        console.error('[AnalyticsAlertService] Error during alert scan:', err.message);
        return { error: err.message };
    }
}

/**
 * Weekly business digest notification summarizing high-level KPIs.
 */
async function runAnalyticsDigestScan() {
    console.log('[AnalyticsAlertService] Running weekly analytics digest scan...');
    try {
        const today = manilaDateString();
        const systemReq = {
            user: {
                employee_id: null,
                permission_level_id: 10,
                permissions: ['analytics:view', 'analytics:financials', 'analytics:export'],
            },
        };

        const result = await analytics.runQuery({
            metrics: ['sales.net_revenue', 'margin.gross_margin_pct', 'ar.balance', 'inventory.dead_stock_value'],
            dimensions: [],
            grain: null,
            dateRange: { preset: 'last_7_days' },
            compare: null,
        }, systemReq, { trusted: true });

        const values = result?.totals?.values || {};
        const rev = formatSlot({ metric: 'sales.net_revenue', value: values['sales.net_revenue'] });
        const margin = formatSlot({ metric: 'margin.gross_margin_pct', value: values['margin.gross_margin_pct'] });
        const ar = formatSlot({ metric: 'ar.balance', value: values['ar.balance'] });
        const dead = formatSlot({ metric: 'inventory.dead_stock_value', value: values['inventory.dead_stock_value'] });

        const body = `7-day summary: Net Revenue ${rev} (${margin} margin), Open AR ${ar}, Dead Stock ${dead}.`;

        await notifications.emitSafe({
            type: 'analytics.weekly_digest',
            category: 'finance',
            severity: 'info',
            title: 'Weekly Business Analytics Digest',
            body,
            linkPage: 'analytics',
            linkState: {
                boardId: 'overview',
                preset: 'last_7_days',
            },
            requiredPermission: 'analytics:view',
            dedupeKey: `analytics.weekly_digest:${today}`,
        });

        console.log('[AnalyticsAlertService] Weekly digest notification emitted.');
        return { success: true };
    } catch (err) {
        console.error('[AnalyticsAlertService] Error during weekly digest scan:', err.message);
        return { error: err.message };
    }
}

async function startAnalyticsAlertEngine() {
    try {
        const { rows } = await db.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('ANALYTICS_ALERT_SCHEDULE', 'ANALYTICS_DIGEST_SCHEDULE')"
        );
        const settingsMap = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
        const alertSchedule = settingsMap.ANALYTICS_ALERT_SCHEDULE || '30 7 * * *';
        const digestSchedule = settingsMap.ANALYTICS_DIGEST_SCHEDULE || '0 8 * * 1';

        console.log(`[AnalyticsAlertService] Scheduling alert scan with pattern: ${alertSchedule}`);
        if (alertCronJob) alertCronJob.stop();
        alertCronJob = cron.schedule(alertSchedule, () => { runAnalyticsAlertScan(); });

        console.log(`[AnalyticsAlertService] Scheduling weekly digest scan with pattern: ${digestSchedule}`);
        if (digestCronJob) digestCronJob.stop();
        digestCronJob = cron.schedule(digestSchedule, () => { runAnalyticsDigestScan(); });
    } catch (err) {
        console.error('[AnalyticsAlertService] Failed to start engine:', err.message);
    }
}

module.exports = {
    startAnalyticsAlertEngine,
    runAnalyticsAlertScan,
    runAnalyticsDigestScan,
    formatSlot,
    formatInsightSentence,
    titleForInsight,
};
