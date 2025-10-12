# Cheque Printer/Writer Feature Updates

## Summary
Updated the cheque printer feature to use standardized 8" × 3" cheque dimensions with improved preview scaling.

## Changes Made

### 1. Updated Default Cheque Dimensions
**File:** `packages/web/src/helpers/cheque.js`

- Changed paper dimensions from 205mm × 95mm to **203.2mm × 76.2mm** (exactly 8" × 3")
- Adjusted element positions to fit the new dimensions:
  - **Payee Name**: Moved from (32, 36) to (30, 28) mm, reduced height from 12 to 10 mm
  - **Cheque Date**: Moved from (150, 18) to (150, 12) mm, reduced height from 10 to 8 mm
  - **Amount Numeric**: Moved from (150, 34) to (150, 26) mm, reduced height from 12 to 10 mm
  - **Amount Words**: Moved from (25, 52) to (25, 42) mm, reduced height from 18 to 16 mm
- Adjusted font sizes for better fit within the smaller vertical space

### 2. Improved Preview Canvas Scaling
**File:** `packages/web/src/components/cheque/TemplateCanvas.jsx`

- Added dynamic DPI scaling for preview mode
- Read-only preview now uses **96 DPI** (standard screen resolution) for realistic size display
- Editor mode still uses full template DPI (typically 300 DPI) for precision editing
- Updated all element positioning calculations to use display DPI
- Canvas now displays at approximately actual size on screen

### 3. Enhanced Preview UI
**File:** `packages/web/src/pages/ChequePrinterPage.jsx`

- Added dimension indicators showing both metric (mm) and imperial (inches) measurements
- Added DPI information to help users understand the preview scale
- Added overflow-auto containers for better handling of large canvases
- Print preview shows: "203.2mm × 76.2mm (8.0" × 3.0") @ 96 DPI preview"
- Editor canvas shows: "203.2mm × 76.2mm (8.0" × 3.0") @ 300 DPI"

## Technical Details

### Cheque Dimensions
- **Width**: 203.2mm (8 inches)
- **Height**: 76.2mm (3 inches)
- **Conversion**: 1 inch = 25.4mm
- **DPI for printing**: 300 (default, configurable)
- **DPI for preview**: 96 (standard screen resolution)

### Preview Scale Calculation
- At 96 DPI, the preview canvas will be approximately: **768px × 288px**
- This provides a near-actual-size preview on standard monitors
- At 300 DPI (editing), the canvas is: **2400px × 900px** for high precision

### Element Position Guidelines (for 8" × 3" cheque)
- **Payee Name**: Upper-left area, typically at x=30mm, y=28mm
- **Date**: Upper-right, typically at x=150mm, y=12mm
- **Amount (Numeric)**: Right side, below date, at x=150mm, y=26mm
- **Amount (Words)**: Lower section, spanning most width, at x=25mm, y=42mm

## Benefits
1. ✅ Standardized to common 8" × 3" cheque size
2. ✅ Preview displays at approximately actual size on screen
3. ✅ Better fit for standard cheque templates
4. ✅ Clear dimension indicators for users
5. ✅ Maintains high-resolution editing and printing (300 DPI)
6. ✅ Responsive preview with overflow handling

## Migration Notes
- Existing templates with different dimensions will continue to work
- Users can still customize dimensions in template settings
- The default template will now use the new 8" × 3" dimensions
- Preview scaling is automatic based on read-only mode

## Testing Recommendations
1. Test preview display on different screen sizes
2. Verify print output matches preview
3. Test template editing with different DPI settings
4. Confirm element positioning on physical cheques
5. Validate PDF generation maintains correct dimensions
