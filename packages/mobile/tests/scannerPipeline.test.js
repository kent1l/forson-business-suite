import test from 'node:test';
import assert from 'node:assert';
import {
  levenshtein,
  isValidEanChecksum,
  createPipelineRefs,
  runConsensus,
  isInROI,
  selectBestRoiBarcode,
  getScreenRoiRect,
} from '../src/utils/scannerPipeline.ts';

test('levenshtein distance calculation', () => {
  assert.strictEqual(levenshtein('123456', '123456'), 0);
  assert.strictEqual(levenshtein('123456', '123457'), 1);
  assert.strictEqual(levenshtein('123456', '123478'), 2);
  assert.strictEqual(levenshtein('123456', '12345'), 1);
  assert.strictEqual(levenshtein('123456', '1234567'), 1);
  assert.strictEqual(levenshtein('123456', '99999999'), 9);
});

test('isValidEanChecksum validation', () => {
  // Valid EAN-13
  assert.strictEqual(isValidEanChecksum('9780201379624'), true);
  // Invalid EAN-13
  assert.strictEqual(isValidEanChecksum('9780201379625'), false);
  // Valid UPC-A (12 digits)
  assert.strictEqual(isValidEanChecksum('036000291452'), true);
  // Invalid UPC-A
  assert.strictEqual(isValidEanChecksum('036000291459'), false);
  // Non-EAN string (Code 128 / QR) should pass through
  assert.strictEqual(isValidEanChecksum('SKU-100492'), true);
});

test('runConsensus sliding window', () => {
  const refs = createPipelineRefs();
  
  // Frame 1: initial string
  assert.strictEqual(runConsensus(refs, '123456789012'), null);
  assert.strictEqual(refs.window.length, 1);

  // Frame 2: same string
  assert.strictEqual(runConsensus(refs, '123456789012'), null);
  assert.strictEqual(refs.window.length, 2);

  // Frame 3: same string -> triggers consensus
  assert.strictEqual(runConsensus(refs, '123456789012'), '123456789012');
  assert.strictEqual(refs.window.length, 0);

  // Item shift re-seeds immediately
  runConsensus(refs, '111111111111');
  assert.strictEqual(refs.window[0], '111111111111');

  runConsensus(refs, '222222222222');
  assert.strictEqual(refs.window[0], '222222222222');
});

test('isInROI coordinate checks', () => {
  const screenDim = { width: 400, height: 800 };
  const roi = getScreenRoiRect(screenDim.width, screenDim.height);

  // Code perfectly centered
  const centerCode = {
    boundingBox: {
      left: roi.left + 10,
      right: roi.right - 10,
      top: roi.top + 10,
      bottom: roi.bottom - 10,
    },
  };
  assert.strictEqual(isInROI(centerCode, screenDim, screenDim), true);

  // Code far outside ROI (top corner)
  const outsideCode = {
    boundingBox: {
      left: 0,
      right: 50,
      top: 0,
      bottom: 50,
    },
  };
  assert.strictEqual(isInROI(outsideCode, screenDim, screenDim), false);
});

test('selectBestRoiBarcode picks closest candidate to ROI center', () => {
  const screenDim = { width: 400, height: 800 };
  const roi = getScreenRoiRect(screenDim.width, screenDim.height);
  const roiCenterX = (roi.left + roi.right) / 2;
  const roiCenterY = (roi.top + roi.bottom) / 2;

  const codeOffCenter = {
    id: 'off-center',
    boundingBox: {
      left: roi.left + 5,
      right: roi.left + 45,
      top: roi.top + 5,
      bottom: roi.top + 45,
    },
  };

  const codeCentered = {
    id: 'centered',
    boundingBox: {
      left: roiCenterX - 20,
      right: roiCenterX + 20,
      top: roiCenterY - 20,
      bottom: roiCenterY + 20,
    },
  };

  const selected = selectBestRoiBarcode([codeOffCenter, codeCentered], screenDim, screenDim);
  assert.strictEqual(selected?.id, 'centered');
});
