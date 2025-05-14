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
import { DragController } from './DragController';

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale);

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
  onViewChange?: (startTime: number, endTime: number) => void;
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
    onViewChange,
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
  const zoomStateRef = useRef<{ min: number; max: number }>({ min: 0, max: 5 });

  // Add a state to track the view range
  const [viewRange, setViewRange] = useState<{ min: number; max: number }>({ min: 0, max: 5 });

  // Add ref to track previous view range
  const prevViewRangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });

  // Add zoom state ref
  const isZoomingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastMouseXRef = useRef<number | null>(null);

  // Store playback time in a ref to avoid re-renders
  const playbackTimeRef = useRef(0);

  // Add state for touch zoom
  const touchStartRef = useRef<{ x1: number; y1: number; x2?: number; y2?: number; distance?: number } | null>(null);

  // Add state for touch pan
  const touchPanRef = useRef<{ x: number; y: number } | null>(null);

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

  // Initialize zoom state and view range when xMax changes
  useEffect(() => {
    if (xMax !== zoomStateRef.current.max) {
      const newRange = { min: 0, max: xMax };
      zoomStateRef.current = newRange;
      setViewRange(newRange);
      
      // Update chart scales if chart exists
      if (chartRef.current?.options?.scales?.x) {
        chartRef.current.options.scales.x.min = 0;
        chartRef.current.options.scales.x.max = xMax;
        chartRef.current.scales.x.min = 0;
        chartRef.current.scales.x.max = xMax;
        chartRef.current.update('none');
      }
    }
  }, [xMax]);

  // Modify useEffect to call onViewChange when view range changes
  useEffect(() => {
    if (onViewChange && viewRange.min !== undefined && viewRange.max !== undefined) {
      // Only trigger if the view range has actually changed and is valid
      if ((viewRange.min !== prevViewRangeRef.current.min || 
           viewRange.max !== prevViewRangeRef.current.max) &&
          !isNaN(viewRange.min) && !isNaN(viewRange.max) &&
          viewRange.max > viewRange.min) {
        prevViewRangeRef.current = { ...viewRange };
        onViewChange(viewRange.min, viewRange.max);
      }
    }
  }, [viewRange, onViewChange]);

  // Modify handleWheel to update viewRange
  const handleWheel = (e: WheelEvent) => {
    const chart = chartRef.current;
    if (!chart || dragControllerRef.current?.isDragging()) return;

    e.preventDefault();

    isZoomingRef.current = true;
    
    const { min: currentMin, max: currentMax } = zoomStateRef.current;
    const mouseX = e.offsetX;
    const chartArea = chart.chartArea;
    
    // Calculate the data value at mouse position
    const xScale = chart.scales.x;
    const mouseDataX = xScale?.getValueForPixel?.(mouseX);
    if (mouseDataX === undefined) return;
    
    // Calculate zoom factor
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    // Calculate new range while keeping mouse position fixed
    const newRange = (currentMax - currentMin) * zoomFactor;
    const mouseRatio = (mouseX - chartArea.left) / (chartArea.right - chartArea.left);
    const newMin = mouseDataX - (newRange * mouseRatio);
    const newMax = newMin + newRange;
    
    // Apply limits
    const finalMin = Math.max(0, newMin);
    const finalMax = Math.min(xMax, Math.max(finalMin + 0.5, newMax));
    
    // Update zoom state and view range
    zoomStateRef.current = { min: finalMin, max: finalMax };
    setViewRange({ min: finalMin, max: finalMax });
    
    // Update chart scales
    if (chart.options.scales?.x) {
      chart.options.scales.x.min = finalMin;
      chart.options.scales.x.max = finalMax;
    }
    
    // Update chart
    chart.update('none');
    
    isZoomingRef.current = false;
  };

  // Modify handleMouseMove for panning to update viewRange
  const handleMouseMove = (e: MouseEvent) => {
    const chart = chartRef.current;
    if (!chart || !lastMouseXRef.current || !isPanningRef.current) return;

    const mouseX = e.offsetX;
    const dx = mouseX - lastMouseXRef.current;
    const xScale = chart.scales.x;
    const pixelsPerUnit = (chart.chartArea.right - chart.chartArea.left) / (xScale.max - xScale.min);
    const deltaX = dx / pixelsPerUnit;

    const { min: currentMin, max: currentMax } = zoomStateRef.current;
    const newMin = Math.max(0, currentMin - deltaX);
    const newMax = Math.min(xMax, currentMax - deltaX);

    if (newMin !== currentMin || newMax !== currentMax) {
      zoomStateRef.current = { min: newMin, max: newMax };
      setViewRange({ min: newMin, max: newMax });
      lastMouseXRef.current = mouseX;
    }

    // Update chart
    chart.update('none');
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && !dragControllerRef.current?.isDragging()) { // Left click only
      isPanningRef.current = true;
      lastMouseXRef.current = e.offsetX;
    }
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
    lastMouseXRef.current = null;
  };

  // Modify touch handlers to support both pan and zoom
  const handleTouchStart = (e: TouchEvent) => {
    if (dragControllerRef.current?.isDragging()) return;
    
    if (e.touches.length === 2) {
      // Pinch-to-zoom start
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      touchStartRef.current = {
        x1: touch1.clientX,
        y1: touch1.clientY,
        x2: touch2.clientX,
        y2: touch2.clientY,
        distance: Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      };
      touchPanRef.current = null; // Clear any existing pan state
    } else if (e.touches.length === 1) {
      // Single-touch pan start
      const touch = e.touches[0];
      touchPanRef.current = {
        x: touch.clientX,
        y: touch.clientY
      };
      touchStartRef.current = null; // Clear any existing zoom state
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    const chart = chartRef.current;
    if (!chart || dragControllerRef.current?.isDragging()) return;

    if (e.touches.length === 2 && touchStartRef.current) {
      // Pinch-to-zoom move
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      // Calculate new distance
      const newDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      const initialDistance = touchStartRef.current.distance!;
      
      // Calculate zoom factor based on the change in distance
      const zoomFactor = newDistance / initialDistance;
      
      // Calculate center point of the pinch
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const rect = chart.canvas.getBoundingClientRect();
      const mouseX = centerX - rect.left;
      
      // Calculate the data value at pinch center
      const xScale = chart.scales.x;
      const mouseDataX = xScale?.getValueForPixel?.(mouseX);
      if (mouseDataX === undefined) return;
      
      const { min: currentMin, max: currentMax } = zoomStateRef.current;
      const chartArea = chart.chartArea;
      
      // Calculate new range while keeping pinch center fixed
      const currentRange = currentMax - currentMin;
      const newRange = currentRange / zoomFactor;
      const mouseRatio = (mouseX - chartArea.left) / (chartArea.right - chartArea.left);
      const newMin = mouseDataX - (newRange * mouseRatio);
      const newMax = newMin + newRange;
      
      // Apply limits
      const finalMin = Math.max(0, newMin);
      const finalMax = Math.min(xMax, Math.max(finalMin + 0.5, newMax));
      
      // Update zoom state
      zoomStateRef.current = { min: finalMin, max: finalMax };
      
      // Update chart scales
      if (chart.options.scales?.x) {
        chart.options.scales.x.min = finalMin;
        chart.options.scales.x.max = finalMax;
      }
      
      // Update view range
      setViewRange({ min: finalMin, max: finalMax });
      
      // Update chart
      chart.update('none');
      
      // Update touch start reference for next move
      touchStartRef.current = {
        x1: touch1.clientX,
        y1: touch1.clientY,
        x2: touch2.clientX,
        y2: touch2.clientY,
        distance: newDistance
      };
    } else if (e.touches.length === 1 && touchPanRef.current) {
      // Single-touch pan move
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchPanRef.current.x;
      
      const xScale = chart.scales.x;
      if (!xScale?.getValueForPixel) return;
      
      const deltaValue0 = xScale.getValueForPixel(0);
      const deltaValueDelta = xScale.getValueForPixel(deltaX);
      if (deltaValue0 === undefined || deltaValueDelta === undefined) return;
      
      const deltaData = deltaValueDelta - deltaValue0;
      
      const { min: currentMin, max: currentMax } = zoomStateRef.current;
      let newMin = currentMin - deltaData;
      let newMax = currentMax - deltaData;
      
      // Apply limits
      if (newMin < 0) {
        newMax += (0 - newMin);
        newMin = 0;
      }
      if (newMax > xMax) {
        newMin -= (newMax - xMax);
        newMax = xMax;
      }
      if (newMin < 0) newMin = 0;
      
      // Update zoom state
      zoomStateRef.current = { min: newMin, max: newMax };
      
      // Update chart scales
      if (chart.options.scales?.x) {
        chart.options.scales.x.min = newMin;
        chart.options.scales.x.max = newMax;
      }
      
      // Update view range
      setViewRange({ min: newMin, max: newMax });
      
      // Update chart
      chart.update('none');
      
      // Update touch reference for next move
      touchPanRef.current = {
        x: touch.clientX,
        y: touch.clientY
      };
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
    touchPanRef.current = null;
  };

  // Update event listeners to include touch zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('mouseleave', handleMouseUp);
    window.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mouseleave', handleMouseUp);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [canvasRef.current, xMax]);

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
    beforeDatasetsDraw: (chart: Chart) => {
      const playbackTime = chart.options.plugins?.playbackIndicator?.playbackTime;
      if (playbackTime == null) return;

      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;

      const ctx = chart.ctx;
      const x = xScale.getPixelForValue(playbackTime);

      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  // Add function to check if device is mobile
  const isMobileDevice = () => {
    return window.matchMedia('(max-width: 768px)').matches;
  };

  // Memoize options without zoom plugin
  const options = useMemo(() => {
    return ({
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0
    },
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { 
        enabled: !isMobileDevice(),  // Disable tooltips on mobile
      },
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
        min: zoomStateRef.current.min,
        max: zoomStateRef.current.max,
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
  })}, [xMax, yRange, loopStart, loopEnd, showLeftMargin, showRightMargin, zoomStateRef.current.min, zoomStateRef.current.max]);

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

  // Update playback time without recalculating options
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart?.options?.plugins) return;

    console.log('Playback update:', {
      playbackTime,
      viewRange,
      chartScales: {
        min: chart.scales.x?.min,
        max: chart.scales.x?.max
      },
      trigger: 'playback time change'
    });
    
    // Store playback time in ref
    playbackTimeRef.current = playbackTime ?? 0;
    
    // During drag, use visual values from the drag controller
    if (dragControllerRef.current?.isDragging()) {
      const visualValues = dragControllerRef.current.getVisualValues();
      chart.options.plugins.loopOverlay = {
        loopStart: visualValues.start,
        loopEnd: visualValues.end
      };
    }
    
    // Update playback time in options
    if (chart.options.plugins.playbackIndicator) {
      chart.options.plugins.playbackIndicator.playbackTime = playbackTime;
    }
    
    // Request redraw without updating scales
    requestAnimationFrame(() => {
      if (!chart?.ctx || !chart.scales.x || !chart.scales.y) return;
      
      // Force a redraw of just the playback indicator
      chart.draw();
    });
  }, [playbackTime]);

  return (
    <div
      style={{
        width: '100%',
        background: '#fff',
        borderRadius: 8,
        padding: 8,
        marginBottom: 24,
        position: 'relative',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 8,
        fontSize: '0.8rem',
        color: '#666',
      }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <span>🖱️ Mouse wheel to zoom</span>
          <span>👆 Drag to pan</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
      </div>

      <div
        style={{
          height: 150,
          width: '100%',
          maxWidth: '100%',
          paddingRight: '0px',
          position: 'relative',
        }}
        className="pitch-graph-container"
      >
        {zoomStateRef.current.max < xMax && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 30,
            background: 'linear-gradient(90deg, transparent, rgba(25, 118, 210, 0.1))',
            pointerEvents: 'none',
            zIndex: 1,
          }} />
        )}
        {zoomStateRef.current.min > 0 && (
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 30,
            background: 'linear-gradient(-90deg, transparent, rgba(25, 118, 210, 0.1))',
            pointerEvents: 'none',
            zIndex: 1,
          }} />
        )}
        
        <Line ref={chartRef} data={chartData} options={{
          ...options,
          layout: {
            padding: {
              right: 30
            }
          }
        }} plugins={[loopOverlayPlugin, playbackIndicatorPlugin, marginIndicatorPlugin]} />
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