// Test script to validate new dashboard components
console.log('Testing dashboard components...');

// Test EnhancedKPICard component
import('../packages/web/src/components/dashboard/EnhancedKPICard.jsx').then(() => {
    console.log('✓ EnhancedKPICard component loads successfully');
}).catch((error) => {
    console.error('✗ EnhancedKPICard component failed to load:', error.message);
});

// Test AnalyticsCharts component
import('../packages/web/src/components/dashboard/AnalyticsCharts.jsx').then(() => {
    console.log('✓ AnalyticsCharts component loads successfully');
}).catch((error) => {
    console.error('✗ AnalyticsCharts component failed to load:', error.message);
});

// Test QuickActionsPanel component
import('../packages/web/src/components/dashboard/QuickActionsPanel.jsx').then(() => {
    console.log('✓ QuickActionsPanel component loads successfully');
}).catch((error) => {
    console.error('✗ QuickActionsPanel component failed to load:', error.message);
});

// Test RecentActivityFeed component
import('../packages/web/src/components/dashboard/RecentActivityFeed.jsx').then(() => {
    console.log('✓ RecentActivityFeed component loads successfully');
}).catch((error) => {
    console.error('✗ RecentActivityFeed component failed to load:', error.message);
});

console.log('Component validation complete!');