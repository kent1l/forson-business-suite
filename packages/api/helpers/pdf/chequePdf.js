const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const launchBrowser = async () => {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  return puppeteer.launch({
    headless: 'new',
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
  });
};

const generateChequePdfBuffer = async ({ html, paperWidthMm, paperHeightMm }) => {
  if (!html) throw new Error('HTML content is required');
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      printBackground: true,
      width: `${paperWidthMm}mm`,
      height: `${paperHeightMm}mm`,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });
    await page.close();
    return buffer;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* noop */ }
    }
  }
};

const generateChequePdfFile = async ({ html, paperWidthMm, paperHeightMm, fileName }) => {
  const buffer = await generateChequePdfBuffer({ html, paperWidthMm, paperHeightMm });
  const safeName = (fileName || `cheque_${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '_');
  const outputDir = path.join(os.tmpdir(), 'cheque-pdfs');
  await fs.mkdir(outputDir, { recursive: true });
  const fullPath = path.join(outputDir, `${safeName}.pdf`);
  await fs.writeFile(fullPath, buffer);
  return { buffer, fullPath };
};

module.exports = {
  generateChequePdfBuffer,
  generateChequePdfFile
};
