import { memo, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import { deriveElementValue, mmToPx } from '../../helpers/cheque';

const classNames = (...values) => values.filter(Boolean).join(' ');

const TemplateCanvas = ({
  template,
  elements,
  payload,
  selectedKey,
  onSelect,
  onChange,
  readOnly = false
}) => {
  const dpi = Number(template?.dpi) || 300;
  const pxPerMm = useMemo(() => dpi / 25.4, [dpi]);
  const widthPx = mmToPx(template?.paper_width_mm || 203.2, dpi);
  const heightPx = mmToPx(template?.paper_height_mm || 92.08, dpi);

  const handleDragStop = (key, d) => {
    if (!onChange) return;
    const x_mm = Number((d.x / pxPerMm).toFixed(2));
    const y_mm = Number((d.y / pxPerMm).toFixed(2));
    onChange(key, { x_mm, y_mm });
  };

  const handleResizeStop = (key, dir, ref, delta, position) => {
    if (!onChange) return;
    const width_mm = Number((ref.offsetWidth / pxPerMm).toFixed(2));
    const height_mm = Number((ref.offsetHeight / pxPerMm).toFixed(2));
    const x_mm = Number((position.x / pxPerMm).toFixed(2));
    const y_mm = Number((position.y / pxPerMm).toFixed(2));
    onChange(key, { x_mm, y_mm, width_mm, height_mm });
  };

  const dragGrid = readOnly ? undefined : [mmToPx(1, dpi), mmToPx(1, dpi)];

  return (
    <div
      className="relative mx-auto border border-slate-300 bg-white shadow-sm"
      style={{ width: widthPx, height: heightPx }}
    >
      {elements.map((element) => {
        const width = mmToPx(element.width_mm, dpi);
        const height = mmToPx(element.height_mm, dpi);
        const x = mmToPx(element.x_mm, dpi);
        const y = mmToPx(element.y_mm, dpi);
        const isSelected = selectedKey === element.key;
        const displayValue = payload ? deriveElementValue(element.key, payload, template) : element.label;
        const fontStyle = {
          fontFamily: element.fontFamily || 'Arial, sans-serif',
          fontSize: `${element.fontSizePt || 12}pt`,
          fontWeight: element.fontWeight || 'normal',
          fontStyle: element.fontStyle || 'normal',
          textAlign: element.textAlign || 'left',
          textTransform: element.textTransform || (element.uppercase ? 'uppercase' : 'none'),
          lineHeight: element.lineHeight || 1.2,
          letterSpacing: element.letterSpacing ? `${element.letterSpacing}pt` : undefined
        };

        return (
          <Rnd
            key={element.key}
            bounds="parent"
            size={{ width, height }}
            position={{ x, y }}
            onDragStop={(_, d) => handleDragStop(element.key, d)}
            onResizeStop={(_, direction, ref, delta, position) => handleResizeStop(element.key, direction, ref, delta, position)}
            disableDragging={readOnly || element.lockPosition}
            enableResizing={!readOnly}
            dragGrid={dragGrid}
            resizeGrid={dragGrid}
            onClick={() => onSelect && onSelect(element.key)}
            className={classNames('group cursor-move', readOnly || element.lockPosition ? 'cursor-default' : '')}
          >
            <div
              className={classNames(
                'h-full w-full overflow-hidden rounded border border-transparent px-1 py-0.5 text-sm transition-colors',
                isSelected && !readOnly ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.3)]' : '',
                readOnly ? 'border-slate-300 bg-slate-50' : '',
                !readOnly ? 'group-hover:border-slate-300' : ''
              )}
              style={fontStyle}
            >
              {displayValue || <span className="opacity-60">{element.label}</span>}
            </div>
          </Rnd>
        );
      })}
    </div>
  );
};

export default memo(TemplateCanvas);
