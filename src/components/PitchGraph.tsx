import { useEffect, useState, useRef, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  Chart,
} from 'chart.js';
import type { Plugin, ChartTypeRegistry } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { ZoomPluginOptions } from 'chartjs-plugin-zoom/types/options';
import { DragController } from './DragController';

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, zoomPlugin);

// Define plugin options type
interface LoopOverlayOptions {
  loopStart?: number;
  loopEnd?: number;
}

// Extend Chart.js types to include our plugins
declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends keyof ChartTypeRegistry> {
    loopOverlay?: LoopOverlayOptions;
    playbackIndicator?: { playbackTime?: number };
    marginIndicator?: { showLeftMargin?: boolean; showRightMargin?: boolean };
  }
}

export interface PitchGraphWithControlsProps {
  times: number[];
  pitches: (number | null)[];
  label?: string;
  color?: string;
  loopStart?: number;
  loopEnd?: number;
  yFit?: [number, number] | null;
  playbackTime?: number;
  onChartReady?: (chart: Chart<'line', (number | null)[], number> | null) => void;
  onLoopChange?: (start: number, end: number) => void;
}

const MIN_VISIBLE_RANGE = 200;
const MAX_VISIBLE_RANGE = 600;
const Y_MIN_LIMIT = 0;
const Y_MAX_LIMIT = 600;

export type PitchGraphChartRef = Chart<'line', (number | null)[], number> | null;

const PitchGraphWithControls = (props: PitchGraphWithControlsProps) => {
  const {
    times,
    pitches,
    label = 'Pitch (Hz)',
    color = '#1976d2',
    loopStart,
    loopEnd,
    yFit,
    playbackTime = undefined,
    onChartReady,
    onLoopChange,
  } = props;
  
  const chartRef = useRef<Chart<'line', (number | null)[], number> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yRange, setYRange] = useState<[number, number]>([Y_MIN_LIMIT, Y_MAX_LIMIT]);
  
  // Create a ref for the drag controller
  const dragControllerRef = useRef<DragController | null>(null);

  // Track mouse position for margin indicators
  const [showLeftMargin, setShowLeftMargin] = useState(false);
  const [showRightMargin, setShowRightMargin] = useState(false);

  // Calculate xMax only when times changes
  const xMax = useMemo(() => {
    return times.length > 0 ? Math.max(2, times[times.length - 1]) : 5;
  }, [times]);

  // Add a ref to store the current zoom state
  const zoomStateRef = useRef<{ min: number; max: number }>({ min: 0, max: xMax });

  // Add a state to track the view range
  const [viewRange, setViewRange] = useState<{ min: number; max: number }>({ min: 0, max: xMax });

  // Update zoom state ref when xMax changes
  useEffect(() => {
    if (zoomStateRef.current.max === 0) {
      zoomStateRef.current = { min: 0, max: xMax };
    }
  }, [xMax]);

  // Initialize drag controller when chart is ready
  useEffect(() => {
    if (chartRef.current && onLoopChange) {
      dragControllerRef.current = new DragController({
        chart: chartRef.current,
        onLoopChange,
        loopStart: loopStart ?? 0,
        loopEnd: loopEnd ?? 0,
        marginThresholdPixels: 40 // Add margin threshold for edge dragging from outside visible area
      });
    }
  }, [chartRef.current]);

  // Update drag controller values when props change
  useEffect(() => {
    if (dragControllerRef.current) {
      dragControllerRef.current.updateValues({
        chart: chartRef.current,
        onLoopChange,
        loopStart: loopStart ?? 0,
        loopEnd: loopEnd ?? 0
      });
    }
  }, [chartRef.current, onLoopChange, loopStart, loopEnd]);

  useEffect(() => {
    if (onChartReady) {
      onChartReady(chartRef.current || null);
    }
  }, [onChartReady, chartRef.current]);

  useEffect(() => {
    if (yFit && yFit.length === 2) {
      setYRange(yFit);
    } else {
      // Default: fit to all pitches
      const validPitches = pitches.filter((p) => p !== null) as number[];
      if (validPitches.length > 0) {
        let minPitch = Math.min(...validPitches);
        let maxPitch = Math.max(...validPitches);
        minPitch = Math.floor(minPitch - 20);
        maxPitch = Math.ceil(maxPitch + 20);
        minPitch = Math.max(Y_MIN_LIMIT, minPitch);
        maxPitch = Math.min(Y_MAX_LIMIT, maxPitch);
        if (maxPitch - minPitch < MIN_VISIBLE_RANGE) {
          const center = (maxPitch + minPitch) / 2;
          minPitch = Math.max(Y_MIN_LIMIT, Math.floor(center - MIN_VISIBLE_RANGE / 2));
          maxPitch = Math.min(Y_MAX_LIMIT, Math.ceil(center + MIN_VISIBLE_RANGE / 2));
        }
        if (maxPitch - minPitch > MAX_VISIBLE_RANGE) {
          const center = (maxPitch + minPitch) / 2;
          minPitch = Math.max(Y_MIN_LIMIT, Math.floor(center - MAX_VISIBLE_RANGE / 2));
          maxPitch = Math.min(Y_MAX_LIMIT, Math.ceil(center + MAX_VISIBLE_RANGE / 2));
        }
        setYRange([minPitch, maxPitch]);
      } else {
        setYRange([Y_MIN_LIMIT, Y_MIN_LIMIT + MIN_VISIBLE_RANGE]);
      }
    }
  }, [pitches, yFit]);

  // Update view range when zoom state changes
  useEffect(() => {
    console.log('View range update triggered:', { 
      zoomState: zoomStateRef.current,
      trigger: 'zoom state change'
    });
    setViewRange(zoomStateRef.current);
  }, [zoomStateRef.current.min, zoomStateRef.current.max]);

  const chartData = {
    labels: times,
    datasets: [
      {
        label,
        data: pitches,
        borderColor: color,
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        spanGaps: false,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  // Overlay plugin for loop region
  const loopOverlayPlugin: Plugin<'line'> = {
    id: 'loopOverlay',
    beforeDatasetsDraw: (chart: Chart) => {
      const options = chart.options.plugins?.loopOverlay;
      if (!options) return;
      
      const ls = options.loopStart;
      const le = options.loopEnd;
      
      if (ls == null || le == null) return;
      
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      const ctx = chart.ctx;
      
      // Draw semi-transparent overlay outside loop region
      ctx.save();
      
      // Left side (before loop start)
      if (ls > xScale.min) {
        ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
        ctx.fillRect(
          xScale.getPixelForValue(xScale.min),
          yScale.top,
          xScale.getPixelForValue(ls) - xScale.getPixelForValue(xScale.min),
          yScale.bottom - yScale.top
        );
      }
      
      // Right side (after loop end)
      if (le < xScale.max) {
        ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
        ctx.fillRect(
          xScale.getPixelForValue(le),
          yScale.top,
          xScale.getPixelForValue(xScale.max) - xScale.getPixelForValue(le),
          yScale.bottom - yScale.top
        );
      }
      
      // Draw loop region borders with thicker lines during drag
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
      ctx.lineWidth = dragControllerRef.current?.isDragging() ? 2 : 1;
      
      // Left border
      ctx.beginPath();
      ctx.moveTo(xScale.getPixelForValue(ls), yScale.top);
      ctx.lineTo(xScale.getPixelForValue(ls), yScale.bottom);
      ctx.stroke();
      
      // Right border
      ctx.beginPath();
      ctx.moveTo(xScale.getPixelForValue(le), yScale.top);
      ctx.lineTo(xScale.getPixelForValue(le), yScale.bottom);
      ctx.stroke();
      
      ctx.restore();
    },
  };

  // Margin indicator plugin
  const marginIndicatorPlugin: Plugin<'line'> = {
    id: 'marginIndicator',
    beforeDatasetsDraw: (chart: Chart) => {
      const options = chart.options.plugins?.marginIndicator;
      if (!options) return;
      
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      
      ctx.save();
      
      // Left margin indicator
      if (options.showLeftMargin) {
        ctx.fillStyle = 'rgba(0, 0, 255, 0.2)';
        ctx.fillRect(
          chartArea.left - 40,
          chartArea.top,
          40,
          chartArea.bottom - chartArea.top
        );
        
        // Draw arrow pointing right
        ctx.fillStyle = 'rgba(0, 0, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(chartArea.left - 25, chartArea.top + (chartArea.bottom - chartArea.top) / 2 - 10);
        ctx.lineTo(chartArea.left - 5, chartArea.top + (chartArea.bottom - chartArea.top) / 2);
        ctx.lineTo(chartArea.left - 25, chartArea.top + (chartArea.bottom - chartArea.top) / 2 + 10);
        ctx.closePath();
        ctx.fill();
      }
      
      // Right margin indicator
      if (options.showRightMargin) {
        ctx.fillStyle = 'rgba(0, 0, 255, 0.2)';
        ctx.fillRect(
          chartArea.right,
          chartArea.top,
          40,
          chartArea.bottom - chartArea.top
        );
        
        // Draw arrow pointing left
        ctx.fillStyle = 'rgba(0, 0, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(chartArea.right + 25, chartArea.top + (chartArea.bottom - chartArea.top) / 2 - 10);
        ctx.lineTo(chartArea.right + 5, chartArea.top + (chartArea.bottom - chartArea.top) / 2);
        ctx.lineTo(chartArea.right + 25, chartArea.top + (chartArea.bottom - chartArea.top) / 2 + 10);
        ctx.closePath();
        ctx.fill();
      }
      
      ctx.restore();
    }
  };

  // Playback indicator plugin
  const playbackIndicatorPlugin: Plugin<'line'> = {
    id: 'playbackIndicator',
    afterDatasetsDraw: (chart: Chart) => {
      const options = chart.options.plugins?.playbackIndicator as { playbackTime?: number };
      if (!options || options.playbackTime == null) return;
      const t = options.playbackTime;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      const x = xScale.getPixelForValue(t);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    },
  };

  // Memoize options with zoom preservation
  const options = useMemo(() => {
    console.log('Options recalculated:', { 
      viewRange,
      playbackTime,
      trigger: 'options memo'
    });
    return ({
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0
    },
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { enabled: true },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.1,
            modifierKey: undefined
          },
          drag: {
            enabled: false
          },
          pinch: {
            enabled: true
          },
          mode: 'x',
          onZoomComplete: function(this: Chart, { chart }: { chart: Chart }) {
            console.log('Zoom complete:', {
              min: chart.scales.x.min,
              max: chart.scales.x.max,
              trigger: 'user zoom'
            });
            const min = chart.scales.x.min ?? 0;
            const max = chart.scales.x.max ?? xMax;
            
            // Calculate valid zoom range while preserving the view width
            const currentRange = max - min;
            const validMax = Math.min(min + currentRange, xMax);
            const validMin = Math.max(0, min);
            
            // Update zoom state ref and view range
            const newRange = { min: validMin, max: validMax };
            zoomStateRef.current = newRange;
            setViewRange(newRange);
          }
        },
        pan: {
          enabled: true,
          mode: 'x' as const,
          modifierKey: undefined,
          onPanComplete: function(this: Chart, { chart }: { chart: Chart }) {
            console.log('Pan complete:', {
              min: chart.scales.x.min,
              max: chart.scales.x.max,
              trigger: 'user pan'
            });
            const min = chart.scales.x.min ?? 0;
            const max = chart.scales.x.max ?? xMax;
            
            // Calculate valid pan range while preserving the view width
            const currentRange = max - min;
            const validMax = Math.min(min + currentRange, xMax);
            const validMin = Math.max(0, min);
            
            // Update zoom state ref and view range
            const newRange = { min: validMin, max: validMax };
            zoomStateRef.current = newRange;
            setViewRange(newRange);
          }
        },
        limits: {
          x: { 
            min: 0, 
            max: xMax, 
            minRange: 0.5 
          },
          y: { 
            min: yRange[0], 
            max: yRange[1], 
            minRange: 50 
          }
        }
      } satisfies Partial<ZoomPluginOptions>,
      loopOverlay: { loopStart, loopEnd },
      playbackIndicator: { playbackTime: 0 },
      marginIndicator: {
        showLeftMargin,
        showRightMargin
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: { display: false },
        ticks: { maxTicksLimit: 8, font: { size: 10 } },
        min: viewRange.min,
        max: viewRange.max,
        grace: '5%',
        bounds: 'data' as const
      },
      y: {
        title: { display: false },
        ticks: { font: { size: 10 } },
        min: yRange[0],
        max: yRange[1],
      },
    },
    elements: {
      line: { tension: 0.2 },
    },
  })}, [xMax, yRange, loopStart, loopEnd, viewRange, showLeftMargin, showRightMargin]);

  // Update chart options when playback time changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart?.options?.plugins) return;

    console.log('Playback update:', {
      playbackTime,
      viewRange,
      chartScales: {
        min: chart.scales.x.min,
        max: chart.scales.x.max
      },
      trigger: 'playback time change'
    });
    
    // During drag, use visual values from the drag controller
    if (dragControllerRef.current?.isDragging()) {
      const visualValues = dragControllerRef.current.getVisualValues();
      
      chart.options.plugins.loopOverlay = {
        loopStart: visualValues.start,
        loopEnd: visualValues.end
      };

      // Disable panning while dragging
      if (chart.options.plugins.zoom?.pan) {
        chart.options.plugins.zoom.pan.enabled = false;
      }
    } else {
      // Not dragging - update loop overlay and re-enable panning
      chart.options.plugins.loopOverlay = { loopStart, loopEnd };
      if (chart.options.plugins.zoom?.pan) {
        chart.options.plugins.zoom.pan.enabled = true;
      }
    }
    
    // Only update the playback indicator
    chart.options.plugins.playbackIndicator = { playbackTime };
    
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
      if (!chart?.ctx) return;
      // Only redraw, don't update scales or other options
      chart.draw();
    });
  }, [playbackTime, loopStart, loopEnd]);

  // Handle reset zoom
  const handleResetZoom = () => {
    if (!chartRef.current) return;
    
    const chart = chartRef.current;
    const newMax = Math.max(2, times[times.length - 1]);
    
    // Update zoom state ref and view range
    const newRange = { min: 0, max: newMax };
    zoomStateRef.current = newRange;
    setViewRange(newRange);
    
    // Update chart scales and options
    if (chart.options.scales?.x) {
      chart.options.scales.x.min = 0;
      chart.options.scales.x.max = newMax;
    }
    
    // Update actual scales
    chart.scales.x.min = 0;
    chart.scales.x.max = newMax;
    
    // Force chart to update its layout
    chart.update('none');
  };

  // Auto-reset zoom when new pitch data is loaded
  useEffect(() => {
    handleResetZoom();
  }, [times]);

  // Set up event listeners when canvas is ready
  useEffect(() => {
    const canvas = canvasRef.current;
    const dragController = dragControllerRef.current;
    if (!canvas || !dragController) return;
    
    // Store mouse event data for pan handler
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const event = 'touches' in e ? e.touches[0] : e;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Check if mouse is in margin areas
      if (chartRef.current) {
        const chartArea = chartRef.current.chartArea;
        setShowLeftMargin(x < chartArea.left && x >= chartArea.left - 40);
        setShowRightMargin(x > chartArea.right && x <= chartArea.right + 40);
      }
      
      canvas.setAttribute('data-last-event', JSON.stringify({ 
        x, 
        y, 
        ctrlKey: 'ctrlKey' in e ? e.ctrlKey : false 
      }));
      dragController.handleMouseMove(e);
    };
    
    const handleMouseDown = (e: MouseEvent | TouchEvent) => dragController.handleMouseDown(e);
    const handleMouseUp = (e: MouseEvent | TouchEvent) => {
      canvas.removeAttribute('data-last-event');
      setShowLeftMargin(false);
      setShowRightMargin(false);
      dragController.handleMouseUp(e);
    };
    
    canvas.addEventListener('mousedown', handleMouseDown, { capture: true });
    canvas.addEventListener('touchstart', handleMouseDown, { capture: true, passive: false });
    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('touchmove', handleMouseMove, { capture: true, passive: false });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });
    window.addEventListener('touchend', handleMouseUp, { capture: true });
    window.addEventListener('mouseleave', handleMouseUp, { capture: true });
    window.addEventListener('touchcancel', handleMouseUp, { capture: true });

    return () => {
      canvas.removeAttribute('data-last-event');
      canvas.removeEventListener('mousedown', handleMouseDown, { capture: true });
      canvas.removeEventListener('touchstart', handleMouseDown, { capture: true });
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('touchmove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      window.removeEventListener('touchend', handleMouseUp, { capture: true });
      window.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      window.removeEventListener('touchcancel', handleMouseUp, { capture: true });
    };
  }, [canvasRef.current, dragControllerRef.current]);

  // Store canvas reference when chart is mounted
  useEffect(() => {
    if (chartRef.current) {
      canvasRef.current = chartRef.current.canvas;
      
      // Set initial zoom state
      if (zoomStateRef.current.max === 0 || zoomStateRef.current.max < xMax) {
        // Calculate initial view range
        const currentRange = zoomStateRef.current.max - zoomStateRef.current.min;
        const validRange = currentRange > 0 ? currentRange : xMax;
        const validMax = Math.min(xMax, validRange);
        const validMin = Math.max(0, validMax - validRange);
        
        // Update zoom state
        zoomStateRef.current = { min: validMin, max: validMax };
        
        // Update chart scales directly
        if (chartRef.current.options.scales?.x) {
          chartRef.current.options.scales.x.min = validMin;
          chartRef.current.options.scales.x.max = validMax;
        }
        chartRef.current.scales.x.min = validMin;
        chartRef.current.scales.x.max = validMax;
      }
    }
  }, [chartRef.current, xMax]);

  // Remove the separate zoom state change listener since we're handling it in the options
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart?.options?.plugins?.zoom) return;

    return () => {
      if (chart.options?.plugins?.zoom) {
        const zoomOptions = chart.options.plugins.zoom;
        if (zoomOptions.zoom) {
          zoomOptions.zoom.onZoomComplete = undefined;
        }
        if (zoomOptions.pan) {
          zoomOptions.pan.onPanComplete = undefined;
        }
      }
    };
  }, [chartRef.current]);

  return (
    <div
      style={{
        width: '100%',
        background: '#fff',
        borderRadius: 8,
        padding: 8,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          height: 150,
          width: '100%',
          maxWidth: '100%',
          paddingRight: '0px',
        }}
        className="pitch-graph-container"
      >
        <Line ref={chartRef} data={chartData} options={{
          ...options,
          layout: {
            padding: {
              right: 30
            }
          }
        }} plugins={[loopOverlayPlugin, playbackIndicatorPlugin, marginIndicatorPlugin]} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={handleResetZoom}
          title="Reset Zoom"
          style={{
            padding: '2px 6px',
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: '#1976d2',
            fontSize: '1.1rem',
            cursor: 'pointer',
            minWidth: 0,
            minHeight: 0,
            lineHeight: 1,
          }}
        >
          ↺
        </button>
      </div>
      <style>{`
        .pitch-graph-container {
          touch-action: manipulation;
          position: relative;
          overflow: visible !important;
        }
        @media (max-width: 768px) {
          .pitch-graph-container {
            touch-action: manipulation;
            height: 100px !important;
            min-height: 100px !important;
            max-height: 100px !important;
            padding-right: 0px !important;
          }
          .pitch-graph-container::-webkit-scrollbar {
            display: none;
          }
          .pitch-graph-container {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        }
      `}</style>
    </div>
  );
};

export default PitchGraphWithControls; 