const normalizeBuffer = (value) => {
  if (!value || (typeof value === 'object' && !value.length)) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  if (typeof value === 'string') {
    try {
      return Buffer.from(value, 'base64');
    } catch (error) {
      console.warn('[bufferUtils] Failed to coerce string to buffer:', error);
      return null;
    }
  }

  return null;
};

const bufferToBase64 = (value) => {
  const buffer = normalizeBuffer(value);
  if (!buffer) return null;
  return buffer.toString('base64');
};

const base64ToBuffer = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const sanitized = value.replace(/\s+/g, '');
    return Buffer.from(sanitized, 'base64');
  } catch (error) {
    console.warn('[bufferUtils] Failed to decode base64 string:', error);
    return null;
  }
};

module.exports = {
  bufferToBase64,
  base64ToBuffer
};
