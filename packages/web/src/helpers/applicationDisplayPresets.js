// Centralized presets for application text formatting
// Each preset can be merged into options passed to formatApplicationText

// Character budgets for the adaptive compression ladder (PRD-FBS-FIT-002 §10d).
// Roughly the number of characters that actually fit at each surface's width in
// the 11.5px monospace the fitment line is set in. They are the one knob worth
// tuning by eye: raise a budget to show more before anything compresses, lower
// it to compress sooner.
//
// The ladder always shows every fitment for as long as it can, spends the
// lossless compressions first (shorthand, two-digit years), then drops the make
// where the model already identifies it, then engine codes, and only hides
// whole fitments behind a count when nothing else fits.

export const APPLICATION_DISPLAY_PRESETS = {
  searchSuggestion: {
    adaptive: true,
    budget: 110,
    showMoreTemplate: (hidden) => `(+${hidden} more)`,
    separator: ', ',
    includeYears: true,
    includeEngine: true,
    mergeModelsByMake: true,
  },
  tableCell: {
    adaptive: true,
    budget: 60,
    showMoreTemplate: (hidden) => `(+${hidden})`,
    includeYears: true,
    includeEngine: true,
    mergeModelsByMake: true,
  },
  // The Power Search panel is wide and is where staff go for the full picture,
  // so it stays uncompressed: every fitment, full names, full years.
  multilineFull: {
    multiline: true,
    separator: '\n',
    truncateMode: 'none',
    includeYears: true,
    includeEngine: true,
    mergeModelsByMake: false,
  },
  compact: {
    adaptive: true,
    budget: 40,
    showMoreTemplate: (hidden) => `(+${hidden})`,
    includeYears: false,
    includeEngine: true,
    mergeModelsByMake: true,
  },
};

export const getPreset = (name) => APPLICATION_DISPLAY_PRESETS[name] || {};

export const registerPreset = (name, options) => {
  APPLICATION_DISPLAY_PRESETS[name] = options;
};

export default APPLICATION_DISPLAY_PRESETS;
