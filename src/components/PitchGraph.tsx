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

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, zoomPlugin);

// Define plugin options type
interface LoopOverlayOptions {
  loopStart?: number;
  loopEnd?: number;
}

// Extend Chart.js types to include our plugin
declare module 'chart.js' {
  interface PluginOptionsByType<TType extends keyof ChartTypeRegistry> {
    loopOverlay?: LoopOverlayOptions;
    playbackIndicator?: { playbackTime?: number };
  }
}

// Add new types for drag state
interface DragState {
  isDragging: boolean;
  edge: 'start' | 'end' | null;
  initialX: number | null;
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

  useEffect(() => {
    if (onChartReady) {
      console.log('Chart ref:', chartRef.current);
      onChartReady(chartRef.current || null);
    }
  }, [onChartReady, chartRef.current]);

  const [yRange, setYRange] = useState<[number, number]>([Y_MIN_LIMIT, Y_MAX_LIMIT]);

  // Update chart options when loop values or playbackTime change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart?.options?.plugins) return;

    chart.options.plugins.loopOverlay = { 
      loopStart: loopStart ?? 0,
      loopEnd: loopEnd ?? 0
    };
    chart.options.plugins.playbackIndicator = { 
      playbackTime: playbackTime ?? 0
    };
    chart.update('none');
  }, [loopStart, loopEnd, playbackTime, yRange]);

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

  // Calculate xMax only when times changes
  const xMax = useMemo(() => {
    return times.length > 0 ? Math.max(2, times[times.length - 1]) : 5;
  }, [times]);

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
      
      // Draw loop region borders
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
      ctx.lineWidth = 1;
      
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

  // Memoize options, do NOT include yRange
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { enabled: true },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x' as const,
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true, speed: 0.01 },
          mode: 'x' as const,
        },
        limits: {
          x: { min: 0, max: xMax },
        },
      },
      // loopOverlay and playbackIndicator will be set via useEffect
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: { display: false },
        ticks: { maxTicksLimit: 8, font: { size: 10 } },
        min: 0,
        max: xMax,
      },
      y: {
        title: { display: false },
        ticks: { font: { size: 10 } },
        // min/max will be set directly on the chart instance
      },
    },
    elements: {
      line: { tension: 0.2 },
    },
  }), [xMax]);

  // When yRange changes, update the chart instance directly
  useEffect(() => {
    const chart = chartRef.current;
    if (chart?.options?.scales?.y) {
      chart.options.scales.y.min = yRange[0];
      chart.options.scales.y.max = yRange[1];
      // Also update overlay and playback indicator
      if (chart.options.plugins) {
        chart.options.plugins.loopOverlay = { loopStart, loopEnd };
        chart.options.plugins.playbackIndicator = { playbackTime };
      }
      chart.update('none');
    }
  }, [yRange, loopStart, loopEnd, playbackTime]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // Add state for drag handling
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    edge: null,
    initialX: null
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Function to get chart coordinates from mouse/touch event
  const getChartCoordinates = (event: MouseEvent | TouchEvent): { x: number, y: number } | null => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    if (!canvas || !chart?.scales?.x || !chart.scales?.y) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    
    const x = chart.scales.x.getValueForPixel?.(clientX - rect.left) ?? 0;
    const y = chart.scales.y.getValueForPixel?.(clientY - rect.top) ?? 0;
    
    return { x, y };
  };

  // Function to check if mouse is near an edge
  const getNearestEdge = (x: number): 'start' | 'end' | null => {
    if (loopStart === undefined || loopEnd === undefined) return null;
    
    const chart = chartRef.current;
    if (!chart || !chart.scales?.x) return null;
    
    const pixelsPerUnit = chart.scales.x.width / (chart.scales.x.max - chart.scales.x.min);
    const threshold = 20 / pixelsPerUnit; // 20 pixels tolerance
    
    if (Math.abs(x - loopStart) <= threshold) return 'start';
    if (Math.abs(x - loopEnd) <= threshold) return 'end';
    return null;
  };

  // Mouse/Touch event handlers
  const handleMouseDown = (event: MouseEvent | TouchEvent) => {
    const coords = getChartCoordinates(event);
    if (!coords) return;

    const edge = getNearestEdge(coords.x);
    if (edge) {
      setDragState({
        isDragging: true,
        edge,
        initialX: coords.x
      });
      event.preventDefault();
    }
  };

  const handleMouseMove = (event: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coords = getChartCoordinates(event);
    if (!coords) return;

    if (dragState.isDragging && dragState.edge && loopStart !== undefined && loopEnd !== undefined) {
      event.preventDefault();
      const chart = chartRef.current;
      if (!chart?.scales?.x || !chart.options?.plugins) return;

      const minX = chart.scales.x.min ?? 0;
      const maxX = chart.scales.x.max ?? 5;
      const newX = Math.max(minX, Math.min(maxX, coords.x));

      if (dragState.edge === 'start' && newX < loopEnd) {
        chart.options.plugins.loopOverlay = { 
          ...(chart.options.plugins.loopOverlay ?? {}),
          loopStart: newX 
        };
      } else if (dragState.edge === 'end' && newX > loopStart) {
        chart.options.plugins.loopOverlay = { 
          ...(chart.options.plugins.loopOverlay ?? {}),
          loopEnd: newX 
        };
      }
      chart.update('none');
    } else {
      // Update cursor based on proximity to edges
      const edge = getNearestEdge(coords.x);
      canvas.style.cursor = edge ? 'ew-resize' : 'default';
    }
  };

  const handleMouseUp = () => {
    if (dragState.isDragging) {
      const chart = chartRef.current;
      if (!chart?.options?.plugins?.loopOverlay) return;

      const newStart = chart.options.plugins.loopOverlay.loopStart ?? loopStart;
      const newEnd = chart.options.plugins.loopOverlay.loopEnd ?? loopEnd;

      // Only call onLoopChange if both values are defined
      if (newStart !== undefined && newEnd !== undefined) {
        if (dragState.edge === 'start') {
          onLoopChange?.(newStart, newEnd);
        } else if (dragState.edge === 'end') {
          onLoopChange?.(newStart, newEnd);
        }
      }
    }
    setDragState({ isDragging: false, edge: null, initialX: null });
  };

  // Add event listeners when the chart is ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const addEventListeners = () => {
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('touchstart', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);
    };

    const removeEventListeners = () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('touchstart', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleMouseUp);
    };

    addEventListeners();
    return removeEventListeners;
  }, [dragState, loopStart, loopEnd]);

  // Store canvas reference when chart is mounted
  useEffect(() => {
    if (chartRef.current) {
      canvasRef.current = chartRef.current.canvas;
    }
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
        }}
        className="pitch-graph-container"
      >
        <Line ref={chartRef} data={chartData} options={options} plugins={[loopOverlayPlugin, playbackIndicatorPlugin]} />
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
          touch-action: pinch-zoom pan-x pan-y;
        }
        @media (max-width: 768px) {
          .pitch-graph-container {
            touch-action: none;
            height: 100px !important;
            min-height: 100px !important;
            max-height: 100px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default PitchGraphWithControls; 