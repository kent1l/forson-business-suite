const { toWords } = require('number-to-words');

const MM_PER_INCH = 25.4;

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatDateForTemplate = (dateValue, format = 'MMMM DD, YYYY') => {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const day = date.getDate().toString().padStart(2, '0');
  const monthIndex = date.getMonth();
  const year = date.getFullYear();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const shortMonthNames = monthNames.map((m) => m.slice(0, 3));

  const replacements = {
    'YYYY': year,
    'YY': String(year).slice(-2),
    'MMMM': monthNames[monthIndex],
    'MMM': shortMonthNames[monthIndex],
    'MM': (monthIndex + 1).toString().padStart(2, '0'),
    'M': monthIndex + 1,
    'DD': day,
    'D': parseInt(day, 10)
  };

  let formatted = format;
  Object.entries(replacements).forEach(([key, value]) => {
    formatted = formatted.replace(new RegExp(key, 'g'), value);
  });
  return formatted;
};

const formatAmountNumeric = (amount, {
  currencySymbol = '',
  useThousandsSeparator = true,
  decimals = 2,
  showCurrencyAfter = false
} = {}) => {
  const n = Number(amount || 0);
  const formatter = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: useThousandsSeparator
  });
  const formatted = formatter.format(n);
  if (!currencySymbol) return formatted;
  return showCurrencyAfter ? `${formatted} ${currencySymbol}` : `${currencySymbol}${formatted}`;
};

const toTitleCase = (value) => value.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());

const amountToWords = (amount, {
  currencyLabel = 'Pesos',
  subCurrencyLabel = 'Centavos',
  joiner = 'and',
  suffix = 'ONLY',
  enforceUppercase = true,
  preserveCase = false
} = {}) => {
  const numeric = Number(amount || 0);
  if (Number.isNaN(numeric)) return '';
  const integerPart = Math.floor(Math.abs(numeric));
  const decimalPart = Math.round((Math.abs(numeric) - integerPart) * 100);

  let words = toWords(integerPart);
  if (!preserveCase) {
    words = toTitleCase(words);
  }

  let result = `${words} ${currencyLabel}`.trim();

  if (decimalPart > 0) {
    const cents = decimalPart.toString().padStart(2, '0');
    result = `${result} ${joiner} ${cents}/100 ${subCurrencyLabel}`.trim();
  }

  if (suffix) {
    result = `${result} ${suffix}`.trim();
  }

  if (enforceUppercase) {
    return result.toUpperCase();
  }
  return result;
};

const buildElementHtml = (element, mapping, dpi) => {
  const pxPerMm = dpi / MM_PER_INCH;
  const {
    key,
    x_mm = 0,
    y_mm = 0,
    width_mm = 40,
    height_mm = 10,
    fontFamily = 'Arial, sans-serif',
    fontSizePt = 12,
    fontWeight = 'normal',
    fontStyle = 'normal',
    textTransform = 'none',
    letterSpacing = 0,
    textAlign = 'left',
    lineHeight = 1.2,
    uppercase = false,
    fallbackText = ''
  } = element || {};

  const rawValue = mapping[key] ?? fallbackText ?? '';
  const displayValue = uppercase ? String(rawValue).toUpperCase() : rawValue;

  const styles = {
    position: 'absolute',
    left: `${(x_mm || 0) * pxPerMm}px`,
    top: `${(y_mm || 0) * pxPerMm}px`,
    width: `${(width_mm || 0) * pxPerMm}px`,
    height: `${(height_mm || 0) * pxPerMm}px`,
    fontFamily,
    fontSize: `${fontSizePt || 12}pt`,
    fontWeight,
    fontStyle,
    textTransform,
    letterSpacing: `${letterSpacing || 0}pt`,
    textAlign,
    lineHeight,
    whiteSpace: 'pre-wrap',
    overflow: 'hidden'
  };

  const styleAttr = Object.entries(styles)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(';');

  return `<div class="cheque-field" style="${styleAttr}">${escapeHtml(displayValue)}</div>`;
};

const renderChequeHtml = (template, payload) => {
  if (!template) throw new Error('Template is required');
  const {
    paper_width_mm = 203.2,
    paper_height_mm = 92.08,
    dpi = 300,
  margin_top_mm = 0,
  margin_left_mm = 0,
    elements = [],
    settings = {}
  } = template;

  const pxPerMm = dpi / MM_PER_INCH;
  const mapping = {
    payee: payload.payee_name,
    payee_name: payload.payee_name,
    date: formatDateForTemplate(payload.cheque_date, settings.dateFormat || 'MMMM DD, YYYY'),
    cheque_date: formatDateForTemplate(payload.cheque_date, settings.dateFormat || 'MMMM DD, YYYY'),
    amount: formatAmountNumeric(payload.amount_numeric, {
      currencySymbol: settings.currencySymbol || '',
      useThousandsSeparator: settings.useThousandsSeparator !== false,
      decimals: Number.isFinite(settings.decimals) ? settings.decimals : 2,
      showCurrencyAfter: settings.showCurrencyAfter === true
    }),
    amount_numeric: formatAmountNumeric(payload.amount_numeric, {
      currencySymbol: settings.currencySymbol || '',
      useThousandsSeparator: settings.useThousandsSeparator !== false,
      decimals: Number.isFinite(settings.decimals) ? settings.decimals : 2,
      showCurrencyAfter: settings.showCurrencyAfter === true
    }),
    amount_words: payload.amount_in_words,
    amountInWords: payload.amount_in_words,
    memo: payload.memo || '',
    cheque_number: payload.cheque_number || '',
    chequeNumber: payload.cheque_number || ''
  };

  const elementHtml = (Array.isArray(elements) ? elements : [])
    .map((el) => buildElementHtml(el, mapping, dpi))
    .join('\n');

  const containerStyles = [
    `position:relative`,
    `width:${paper_width_mm * pxPerMm}px`,
    `height:${paper_height_mm * pxPerMm}px`,
    `margin:${margin_top_mm * pxPerMm}px auto 0 auto`,
    `margin-left:calc(50% - ${(paper_width_mm * pxPerMm) / 2}px + ${margin_left_mm * pxPerMm}px)`,
    `background:#fff`,
    `color:#000`,
    `box-sizing:border-box`
  ].join(';');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cheque Preview</title>
  <style>
    @page { size: ${paper_width_mm}mm ${paper_height_mm}mm; margin: 0; }
    body { margin: 0; background: #f3f4f6; display: flex; justify-content: center; align-items: flex-start; }
    .cheque-container { ${containerStyles}; }
    .cheque-field { position: absolute; }
  </style>
</head>
<body>
  <div class="cheque-container">
    ${elementHtml}
  </div>
</body>
</html>`;
};

module.exports = {
  escapeHtml,
  formatAmountNumeric,
  formatDateForTemplate,
  amountToWords,
  renderChequeHtml
};
