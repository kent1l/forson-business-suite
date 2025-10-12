import { toWords } from 'number-to-words';

const MM_PER_INCH = 25.4;

export const mmToPx = (mm, dpi = 300) => (Number(mm) || 0) / MM_PER_INCH * dpi;

export const defaultTemplate = () => ({
  template_name: 'Standard Cheque Layout',
  description: 'Default layout for printing name, date, amount and amount in words',
  paper_width_mm: 203.2,
  paper_height_mm: 76.2,
  dpi: 300,
  margin_top_mm: 0,
  margin_left_mm: 0,
  settings: {
    currencySymbol: '₱',
    currencyLabel: 'Pesos',
    subCurrencyLabel: 'Centavos',
    amountWordsJoiner: 'and',
    amountWordsSuffix: 'ONLY',
    dateFormat: 'MMMM DD, YYYY',
    decimals: 2,
    useThousandsSeparator: true,
    showCurrencyAfter: false,
    enforceUppercase: true,
    preserveCase: false
  },
  elements: [
    {
      key: 'payee_name',
      label: 'Payee Name',
      x_mm: 30,
      y_mm: 28,
      width_mm: 120,
      height_mm: 10,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 11,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'left',
      lineHeight: 1.2,
      uppercase: true
    },
    {
      key: 'cheque_date',
      label: 'Date',
      x_mm: 150,
      y_mm: 12,
      width_mm: 45,
      height_mm: 8,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 10,
      fontWeight: 'normal',
      textAlign: 'center'
    },
    {
      key: 'amount_numeric',
      label: 'Amount (Numeric)',
      x_mm: 150,
      y_mm: 26,
      width_mm: 45,
      height_mm: 10,
      fontFamily: 'Courier New, monospace',
      fontSizePt: 11,
      fontWeight: 'bold',
      textAlign: 'center'
    },
    {
      key: 'amount_words',
      label: 'Amount in Words',
      x_mm: 25,
      y_mm: 42,
      width_mm: 170,
      height_mm: 16,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 10,
      textAlign: 'left',
      lineHeight: 1.3,
      uppercase: true
    }
  ]
});

const BASE_TEMPLATE = defaultTemplate();

const toTitleCase = (value) => value.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());

export const amountToWords = (amount, settings = {}) => {
  const numeric = Number(amount || 0);
  if (Number.isNaN(numeric)) return '';
  const absValue = Math.abs(numeric);
  const integerPart = Math.floor(absValue);
  const decimalPart = Math.round((absValue - integerPart) * 100);

  const options = {
    currencyLabel: settings.currencyLabel || 'Pesos',
    subCurrencyLabel: settings.subCurrencyLabel || 'Centavos',
    joiner: settings.amountWordsJoiner || settings.joiner || 'and',
    suffix: settings.amountWordsSuffix || settings.suffix || 'ONLY',
    enforceUppercase: settings.enforceUppercase !== false,
    preserveCase: settings.preserveCase === true
  };

  let words = toWords(integerPart);
  if (!options.preserveCase) {
    words = toTitleCase(words);
  }

  let result = `${words} ${options.currencyLabel}`.trim();
  if (decimalPart > 0) {
    const cents = decimalPart.toString().padStart(2, '0');
    result = `${result} ${options.joiner} ${cents}/100 ${options.subCurrencyLabel}`.trim();
  }
  if (options.suffix) {
    result = `${result} ${options.suffix}`.trim();
  }
  return options.enforceUppercase ? result.toUpperCase() : result;
};

export const formatAmountNumeric = (amount, settings = {}) => {
  const numeric = Number(amount || 0);
  if (Number.isNaN(numeric)) return '';
  const formatter = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: settings.decimals ?? 2,
    maximumFractionDigits: settings.decimals ?? 2,
    useGrouping: settings.useThousandsSeparator !== false
  });
  const formatted = formatter.format(numeric);
  const symbol = settings.currencySymbol || '';
  if (!symbol) return formatted;
  return settings.showCurrencyAfter ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};

export const formatChequeDate = (dateValue, format = 'MMMM DD, YYYY') => {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const day = date.getDate().toString().padStart(2, '0');
  const monthIndex = date.getMonth();
  const year = date.getFullYear();

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const shortMonths = months.map((m) => m.slice(0, 3));

  const replacements = {
    'YYYY': year,
    'YY': String(year).slice(-2),
    'MMMM': months[monthIndex],
    'MMM': shortMonths[monthIndex],
    'MM': (monthIndex + 1).toString().padStart(2, '0'),
    'M': monthIndex + 1,
    'DD': day,
    'D': Number(day)
  };

  let formatted = format;
  Object.entries(replacements).forEach(([token, value]) => {
    formatted = formatted.replace(new RegExp(token, 'g'), value);
  });
  return formatted;
};

export const deriveElementValue = (key, payload, template) => {
  const settings = template?.settings || {};
  switch (key) {
    case 'payee_name':
    case 'payee':
      return payload.payee_name || '';
    case 'cheque_date':
    case 'date':
      return formatChequeDate(payload.cheque_date, settings.dateFormat || 'MMMM DD, YYYY');
    case 'amount':
    case 'amount_numeric':
      return formatAmountNumeric(payload.amount_numeric, settings);
    case 'amount_words':
    case 'amountInWords':
      return payload.amount_in_words || '';
    case 'memo':
      return payload.memo || '';
    case 'cheque_number':
    case 'chequeNumber':
      return payload.cheque_number || '';
    default:
      return '';
  }
};

export const normalizeTemplate = (template) => ({
  ...BASE_TEMPLATE,
  ...template,
  settings: { ...BASE_TEMPLATE.settings, ...(template?.settings || {}) },
  elements: (template?.elements || BASE_TEMPLATE.elements).map((el) => ({
    ...el,
    label: el.label || el.key,
    x_mm: Number(el.x_mm) || 0,
    y_mm: Number(el.y_mm) || 0,
    width_mm: Number(el.width_mm) || 40,
    height_mm: Number(el.height_mm) || 10,
    fontSizePt: Number(el.fontSizePt) || 12,
    lineHeight: el.lineHeight ? Number(el.lineHeight) : 1.2,
    uppercase: Boolean(el.uppercase)
  }))
});
