import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import React, { useState, useLayoutEffect, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import throttle from 'lodash.throttle'
import GridLayout from 'react-grid-layout';
import { XMarkIcon } from '@heroicons/react/24/outline';

const ResidueColorSchemes = {
  protein: {
    default: {
      A: 'bg-green-200', C: 'bg-yellow-200', D: 'bg-red-200', E: 'bg-red-200',
      F: 'bg-purple-200', G: 'bg-gray-200', H: 'bg-pink-200', I: 'bg-blue-200',
      K: 'bg-orange-200', L: 'bg-blue-200', M: 'bg-blue-100', N: 'bg-red-100',
      P: 'bg-teal-200', Q: 'bg-red-100', R: 'bg-orange-300', S: 'bg-green-100',
      T: 'bg-green-100', V: 'bg-blue-100', W: 'bg-purple-300', Y: 'bg-purple-100',
      '-': 'bg-white'
    }},
    
  nucleotide: {
    default: {
      'A': 'bg-green-200',  
      'C': 'bg-blue-200',    
      'G': 'bg-yellow-200',  
      'T': 'bg-red-200',      
      'U': 'bg-red-200',      
      'N': 'bg-gray-200',     
      '-': 'bg-white',   
      '.': 'bg-white'    
    }}
};

const CELL_SIZE = 24;
const LABEL_WIDTH = 100;

const proteinOnlyChars = new Set(['D', 'E', 'F', 'H', 'I', 'K', 'L', 'M', 'P', 'Q', 'R', 'S', 'V', 'W', 'Y']);


function RemoveButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="p-0.5"
    >
      <span className="inline-flex items-center justify-center w-6 h-6
       rounded-lg bg-gray-100 border border-gray-400 hover:bg-red-300">
       <XMarkIcon className="w-4 h-4 text-red-700 flex-shrink-0" />
      </span>
    </button>
  );
}

function detectFileType(filename, text){
  const lower = filename.toLowerCase();
  if (/\.(fasta|fas|fa)$/.test(lower)) return 'alignment'; // by extension first
  const head = text.slice(0, 2000); // by quick content sniff as fallback
  if (/^>\S/m.test(head)) return 'alignment';
  return 'unknown';
};

function isNucleotide(msaData) {
  if (!msaData || msaData.length === 0) return true;
  for (let i = 0; i < Math.min(msaData.length, 10); i++) {
    const seq = msaData[i].sequence.toUpperCase();
    for (let j = 0; j < Math.min(seq.length, 50); j++) {
      if (proteinOnlyChars.has(seq[j])) return false;
    }
  }
  return true;
}

function parseFasta(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let current = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith(">")) {
      if (current) result.push(current);
      current = { id: line.slice(1).trim(), sequence: "" };
    } else if (current) {
      current.sequence += line.trim();
    }
  }
  if (current) result.push(current);

  return result;
}

const PanelHeader = React.memo(function PanelHeader({
  id,
  filename,
  onRemove,
}) {
  return (
    <div className="upload-btn-trigger panel-drag-handle bg-gradient-to-b from-gray-100 to-white pt-1 px-1 mb-1 cursor-move flex flex-wrap items-center justify-between gap-x- gap-y-1 font-bold focus:outline-none select-none">
      <div className="flex-1 flex justify-center">
        <div className="flex items-center">
      <span>{filename}</span>
      
    </div>
      </div>
      <div className="flex flex-wrap items-center gap-1" style={{ marginTop: '1px' }}>
        <div className="w-7 h-7 flex items-center justify-center">
          <RemoveButton onClick={() => onRemove(id)} />
        </div>
      </div>
    </div>
  );
});

function PanelContainer({ id, children, setHoveredPanelId }) {
  return (
    <div className="border rounded-2xl overflow-hidden h-full flex flex-col bg-white shadow-lg focus:outline-none select-none" onMouseEnter={() => setHoveredPanelId(id)} onPointerLeave={() => setHoveredPanelId(null)}>
      {children}
    </div>
  );
}

const useVirtualization = (scrollTop, scrollLeft, viewportWidth, viewportHeight, totalRows, totalCols, itemHeight, itemWidth) => {
  return useMemo(() => {
    const overscan = 5;

    const visibleRows = Math.ceil(viewportHeight / itemHeight);
    const visibleCols = Math.ceil(viewportWidth / itemWidth);

    const firstRow = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const lastRow = Math.min(totalRows, firstRow + visibleRows + (overscan * 2));

    const firstCol = Math.max(0, Math.floor(scrollLeft / itemWidth) - overscan);
    const lastCol = Math.min(totalCols, firstCol + visibleCols + (overscan * 2));

    return { firstRow, lastRow, firstCol, lastCol };
  }, [scrollTop, scrollLeft, viewportWidth, viewportHeight, totalRows, totalCols, itemHeight, itemWidth]);
};

function useElementSize({ debounceMs = 0 } = {}) {
  const nodeRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    let frame = null;
    let t = null;

    const update = (next) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize((prev) =>
          (Math.round(prev.width) === Math.round(next.width) &&
           Math.round(prev.height) === Math.round(next.height))
            ? prev
            : { width: next.width, height: next.height }
        );
      });
    };

    const schedule = (next) => {
      if (debounceMs > 0) {
        if (t) clearTimeout(t);
        t = setTimeout(() => update(next), debounceMs);
      } else {
        update(next);
      }
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
      const next = box
        ? { width: box.inlineSize, height: box.blockSize }
        : { width: entry.contentRect.width, height: entry.contentRect.height };

      schedule(next);
    });

    ro.observe(el);

    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (t) clearTimeout(t);
    };
  }, [debounceMs]);

  return [nodeRef, size];
}

const MSACell = React.memo(function MSACell({ style, char, isHighlighted, scheme = 'default', isNuc }) {
  const category = isNuc ? 'nucleotide' : 'protein';
  const mapping = ResidueColorSchemes[category][scheme];
  const background = mapping[char?.toUpperCase()] || 'bg-white';
  
  const highlightClass = isHighlighted ? 'alignment-highlight' : '';

  return (
    <div style={style} className={`flex items-center justify-center ${background} ${highlightClass}`}>
      {char}
    </div>
  );
}, (prev, next) => prev.char === next.char && prev.isHighlighted === next.isHighlighted && prev.style === next.style);

function MSATooltip({ x, y, children, boundary }) {
  const ref = React.useRef(null);
  const GAP = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rightEdge = boundary ? boundary.right : vw;
  const flipX = x + 150 > rightEdge;
  const flipY = y + 50 > vh;

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="fixed px-2 py-1 text-sm bg-gray-100 rounded-xl pointer-events-none z-[9999] shadow border border-gray-400 font-sans"
      style={{
        left: x + (flipX ? -GAP : GAP),
        top: y + (flipY ? -GAP : GAP),
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

const AlignmentPanel = React.memo(function AlignmentPanel({ id, data, onRemove, setHoveredPanelId, setPanelData }) {
  const msaData = useMemo(() => data.data, [data.data]);
  const isNuc = useMemo(() => isNucleotide(msaData), [msaData])
  const containerRef = useRef(null);
  const [viewportRef, viewportSize] = useElementSize({ debounceMs: 90 });
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [labelWidth, setLabelWidth] = useState(data.labelWidth ?? LABEL_WIDTH);

  const dragRef = useRef();
  const isDraggingLabel = useRef(false);
  
  const handleDrag = useCallback((e) => {
    if (!isDraggingLabel.current) return;
    
    const delta = e.clientX - dragRef.current;
    dragRef.current = e.clientX;
    
    setLabelWidth(prev => {
      const nextWidth = Math.max(40, Math.min(400, prev + delta));
      requestAnimationFrame(() => {
        setPanelData(prevData => {
          if (prevData[id]?.labelWidth === nextWidth) return prevData;
          return {
            ...prevData,
            [id]: { ...prevData[id], labelWidth: nextWidth }
          };
        });
      });

      return nextWidth;
    });
  }, [id, setPanelData]);

  const handleDragEnd = useCallback(() => {
    isDraggingLabel.current = false;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleDrag);
    window.removeEventListener('mouseup', handleDragEnd);
  }, [handleDrag]);

  const handleDragStart = useCallback((e) => {
    isDraggingLabel.current = true;
    dragRef.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleDrag);
    window.addEventListener('mouseup', handleDragEnd);
  }, [handleDrag, handleDragEnd]);

  const rowCount = msaData.length;
  const colCount = msaData[0]?.sequence.length || 0;
  const totalGridWidth = colCount * CELL_SIZE;
  const totalGridHeight = rowCount * CELL_SIZE;
  const RULER_HEIGHT = CELL_SIZE / Math.round(1.5);


  const [hoveredCol, setHoveredCol] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });


  const { firstRow, lastRow, firstCol, lastCol } = useVirtualization(
    scrollTop,
    scrollLeft,
    viewportSize.width - labelWidth,
    viewportSize.height - RULER_HEIGHT,
    rowCount,
    colCount,
    CELL_SIZE,
    CELL_SIZE
  );

  const rowIndices = useMemo(() => 
    Array.from({ length: lastRow - firstRow }, (_, i) => firstRow + i), 
  [firstRow, lastRow]);

  const colIndices = useMemo(() => 
    Array.from({ length: lastCol - firstCol }, (_, i) => firstCol + i), 
  [firstCol, lastCol]);

  const gridCells = useMemo(() => {
    const cells = [];
    for (const rowIndex of rowIndices) {
      const rowSequence = msaData[rowIndex].sequence;
      for (const columnIndex of colIndices) {
        cells.push(
          <MSACell
            key={`${rowIndex}-${columnIndex}`}
            char={rowSequence[columnIndex]}
            isHighlighted={hoveredCol === columnIndex}
            scheme={data.residueColorScheme || 'default'}
            isNuc={isNuc}
            style={{
              position: 'absolute',
              top: rowIndex * CELL_SIZE,
              left: columnIndex * CELL_SIZE,
              height: CELL_SIZE,
              width: CELL_SIZE,
            }}
          />
        );
      }
    }
    return cells;
  }, [rowIndices, colIndices, msaData, hoveredCol]);


  const lastMousePosRef = useRef({ x: 0, y: 0 });

  const updateHoverState = useCallback((clientX, clientY, sl, st) => {
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    
    const mouseXRelative = clientX - rect.left;
    const mouseYRelative = clientY - rect.top;

    const isOverCells = mouseXRelative > labelWidth;
    
    const col = isOverCells 
      ? Math.floor((mouseXRelative - labelWidth + sl) / CELL_SIZE) 
      : null;
      
    const row = Math.floor((mouseYRelative - RULER_HEIGHT + st) / CELL_SIZE);

    if (row >= 0 && row < rowCount) setHoveredRow(row);
    else setHoveredRow(null);

    if (col >= 0 && col < colCount) setHoveredCol(col);
    else setHoveredCol(null);
    
    setTooltipPos({ x: clientX, y: clientY });
  }, [labelWidth, colCount, rowCount, RULER_HEIGHT]);

  const handleMouseMove = useCallback((e) => {
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    updateHoverState(e.clientX, e.clientY, scrollLeft, scrollTop);
  }, [updateHoverState, scrollLeft, scrollTop]);

  const onScroll = useMemo(() => throttle((e) => {
    if (!e?.currentTarget) return;
    const { scrollLeft: sl, scrollTop: st } = e.currentTarget;
    setScrollLeft(sl);
    setScrollTop(st);
    
    updateHoverState(lastMousePosRef.current.x, lastMousePosRef.current.y, sl, st);
  }, 8), [updateHoverState]);

  return (
    <PanelContainer id={id} setHoveredPanelId={setHoveredPanelId}>
      <div ref={containerRef} className="relative flex flex-col h-full bg-white overflow-hidden">
        <PanelHeader id={id} filename={data.filename} setPanelData={setPanelData} onRemove={onRemove} />
        {hoveredCol !== null && (
          <MSATooltip x={tooltipPos.x} y={tooltipPos.y} boundary={scrollContainerRef.current?.getBoundingClientRect()}>
            <div className="flex flex-col items-center">
              <span className="font-bold">Site {hoveredCol + 1}</span>
              <span className="text-gray-600 text-xs">{msaData[hoveredRow]?.id}</span>
            </div>
          </MSATooltip>
        )}
        <div ref={viewportRef} className="flex-1 flex flex-col overflow-hidden font-mono text-sm">
          <div ref={scrollContainerRef} className="w-full h-full overflow-auto" onScroll={onScroll}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoveredCol(null); setHoveredRow(null); }}
          >
            <div className="relative" style={{ width: totalGridWidth + labelWidth, height: totalGridHeight + RULER_HEIGHT }}>
              {/* Top Row: Sticky Corner + Sticky Ruler */}
                 <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 6 }}>
                   <div style={{ left: 0, width: labelWidth, height: RULER_HEIGHT, background: 'white', zIndex: 6, }}>
                     <div className="w-full h-full"/>
                   </div>
                   <div style={{ left: 0, width: totalGridWidth, height: RULER_HEIGHT, background: 'white', zIndex: 3, display: 'flex', position: 'relative',marginTop:-1 }}>
                  <div className="relative w-full h-full ">
                    {useMemo(() => 
                      colIndices.map((columnIndex) => {
                        const p = columnIndex + 1;
                        const showNum = p % 10 === 0 || p === 1 || p === colCount;
                        const showTick = p % 5 === 0 && !showNum;
                        if (!showNum && !showTick) return null;
                        
                        return (
                          <div key={columnIndex}
                              className="absolute flex items-center justify-center text-xs text-gray-600"
                              style={{ left: columnIndex * CELL_SIZE, width: CELL_SIZE, height: RULER_HEIGHT }}>
                            {showNum ? p : '·'}
                          </div>
                        );
                      }), 
                      [colIndices, colCount, CELL_SIZE]
                    )}
                  </div>
                   </div>
                 </div>
              {/* --- Sticky Left Column (Labels + Drag Handle) --- */}
              <div style={{ position: 'sticky', top: RULER_HEIGHT, left: 0, width: labelWidth, height: totalGridHeight, zIndex: 5 }}>
                <div style={{ width: '100%', height: '100%', background: 'white', position: 'relative' }}>
                  {rowIndices.map((rowIndex) => (
                    <div 
                      key={rowIndex}
                      title={msaData[rowIndex].id}
                      style={{ position: 'absolute', transform: `translateY(${rowIndex * CELL_SIZE}px)`, left: 0, width: '100%', height: CELL_SIZE, lineHeight: `${CELL_SIZE}px` }}
                      className={`flex items-center text-right font-bold truncate pl-2 pr-2 border-r border-gray-100 ${hoveredRow === rowIndex ? 'bg-yellow-100' : ''}`}>
                      <span className="block truncate">{msaData[rowIndex].id}</span>
                    </div>
                  ))}
                </div>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'col-resize', zIndex: 10, background: 'rgba(0,0,0,0.02)' }} onMouseDown={handleDragStart} />
              </div>
              {/* --- Virtualized Grid of Cells --- */}
              <div style={{ position: 'absolute', top: RULER_HEIGHT, left: labelWidth, height: totalGridHeight, width: totalGridWidth }}>
                {gridCells}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PanelContainer>
  );
});

function App() {
  const [history, setHistory] = useState({ past: [], present: { panels: [], layout: [], panelData: {} }, future: [] });
  const { panels, layout, panelData } = history.present;
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [hoveredPanelId, setHoveredPanelId] = useState(null);
  const fileInputRef = useRef(null);

  const addPanel = useCallback((config) => {
    const { type, data } = config;
    const newId = `${type}-${Date.now()}`;
    let defaultH = 20;
    const proportionalHeight = 2 + Math.ceil(data.data.length * 0.8); // height proportional to the number of sequences.
    defaultH = Math.max(3, Math.min(defaultH, proportionalHeight));

    setHistory(h => {
      const nextPresent = {
        panels: [...h.present.panels, { i: newId, type }],
        layout: [...h.present.layout, { i: newId, x: 0, y: 0, w: 12, h: defaultH, minW: 2, minH: 2 }],
        panelData: { ...h.present.panelData, [newId]: data }
      };
      return { past: [...h.past, h.present], present: nextPresent, future: [] };
    });
  }, []);

  const removePanel = useCallback((id) => {
    setHistory(h => {
      const newPanelData = { ...h.present.panelData };
      delete newPanelData[id];
      const nextPresent = {
        panels: h.present.panels.filter(p => p.i !== id),
        layout: h.present.layout.filter(l => l.i !== id),
        panelData: newPanelData
      };
      return { past: [...h.past, h.present], present: nextPresent, future: [] };
    });
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseFasta(text);
    addPanel({ type: 'alignment', data: { data: parsed, filename: file.name } });
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) {
      const text = await f.text();
      if (detectFileType(f.name, text) === 'alignment') {
        addPanel({ type: 'alignment', data: { data: parseFasta(text), filename: f.name } });
      }
    }
  };

  const setPanelData = useCallback((updater) => {
    setHistory(currentHistory => {
      const oldPresent = currentHistory.present;
      const newPanelData = typeof updater === 'function' 
        ? updater(oldPresent.panelData) 
        : updater;
      
      return {
        ...currentHistory,
        present: { ...oldPresent, panelData: newPanelData }
      };
    });
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
      <div className="fixed top-0 left-0 w-full z-50 p-4 flex justify-between items-center pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={() => fileInputRef.current.click()} className="bg-green-200 hover:bg-green-300 px-6 py-4 rounded-xl shadow-lg transition">Upload MSA</button>
          <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
        </div>
      </div>

      <div className="flex-grow overflow-auto pb-10">
        <div className="flex flex-col items-center justify-center p-6 mt-2 mb-4">
          {panels.length === 0 && (
            <div className='max-w-80'>
            <div className="text-3xl font-bold mt-20 text-gray-400 text-center">
              Drag and drop multiple sequence alignment files in fasta format
              or use the upload button
            </div>
            <div className="text-4xl font-bold mt-80 text-gray-400 text-center">
              Powered by <a href="https://www.mseaboard.com" target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-400">MSEABOARD</a>
            </div>
            </div>
          )}
        </div>

        <GridLayout 
          className="layout" 
          layout={layout} 
          cols={12} 
          rowHeight={30} 
          width={windowWidth} 
          draggableHandle=".panel-drag-handle"
          draggableCancel="button, .upload-btn-trigger, select, input"
          onLayoutChange={l => setHistory(h => ({ ...h, present: { ...h.present, layout: l } }))}
        >
          {panels.map(p => (
            <div key={p.i}>
              <AlignmentPanel 
                id={p.i} 
                data={panelData[p.i]} 
                onRemove={removePanel} 
                setHoveredPanelId={setHoveredPanelId} 
                setPanelData={setPanelData} 
              />
            </div>
          ))}
        </GridLayout>
      </div>
    </div>
  );
}

export default App;