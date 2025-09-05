/**
 * Format a single application object into a display string
 * @param {Object} application - The application object
 * @returns {string} Formatted application text
 */
const formatSingleApplication = (application) => {
    if (!application) return '';
    if (typeof application === 'string') return application;
    if (typeof application === 'object') {
        // If there's a pre-formatted display property, use it
        if (application.display) return application.display;
        
        // Otherwise, construct from make, model, engine
        return [application.make, application.model, application.engine]
            .filter(Boolean) // Remove falsy values
            .join(' ');
    }
    return String(application);
};

/**
 * Formats application data into a display string
 * @param {Array|Object|string} applications - The applications data to format
 * @param {Object} options - Formatting options
 * @param {string} options.separator - Separator between multiple applications (default: ', ')
 * @param {boolean} options.truncate - Whether to truncate the output (default: false)
 * @param {number} options.maxLength - Maximum length before truncation (default: 100)
 * @returns {string} Formatted applications text
 */
export const formatApplicationText = (applications, options = {}) => {
    const {
        separator = ', ',
        truncate = false,
        maxLength = 100
    } = options;

    if (!applications) return '';

    // Handle array of applications
    if (Array.isArray(applications)) {
        const formatted = applications
            .map(formatSingleApplication)
            .filter(Boolean)
            .join(separator);
            
        if (truncate && formatted.length > maxLength) {
            return `${formatted.substring(0, maxLength - 3)}...`;
        }
        return formatted;
    }

    // Handle single application (object or string)
    const formatted = formatSingleApplication(applications);
    if (truncate && formatted.length > maxLength) {
        return `${formatted.substring(0, maxLength - 3)}...`;
    }
    return formatted;
};

export default formatApplicationText;
