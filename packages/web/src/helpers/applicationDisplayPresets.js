// Centralized presets for application text formatting
// Each preset can be merged into options passed to formatApplicationText

export const APPLICATION_DISPLAY_PRESETS = {
  searchSuggestion: {
    truncateMode: 'logical',
    maxApplications: 2,
    showMoreTemplate: (hidden) => `(+${hidden} more)`,
    separator: ', ',
    includeYears: true,
    includeEngine: true,
    collapseDuplicateEngines: true,
    truncateChars: 80,
  },
  tableCell: {
    truncateMode: 'chars',
    truncateChars: 60,
    includeYears: false,
    includeEngine: true,
    collapseDuplicateEngines: true,
  },
  multilineFull: {
    multiline: true,
    separator: '\n',
    truncateMode: 'none',
    includeYears: true,
    includeEngine: true,
  },
  compact: {
    truncateMode: 'logical',
    maxApplications: 1,
    showMoreTemplate: (hidden) => `(+${hidden})`,
    includeYears: false,
    includeEngine: true,
    truncateChars: 40,
  },
};

export const getPreset = (name) => APPLICATION_DISPLAY_PRESETS[name] || {};

export const registerPreset = (name, options) => {
  APPLICATION_DISPLAY_PRESETS[name] = options;
};

export default APPLICATION_DISPLAY_PRESETS;
