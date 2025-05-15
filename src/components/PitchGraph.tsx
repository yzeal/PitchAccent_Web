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

// Add new type definitions for segment coloring
interface SegmentContext {
  p1DataIndex: number;
  p2DataIndex: number;
}

interface SegmentOptions {
  borderColor: string | ((ctx: SegmentContext) => string);
  borderDash: number[] | ((ctx: SegmentContext) => number[]);
}

// Extend Chart.js dataset types to include our segment property
declare module 'chart.js' {
  interface LineControllerDatasetOptions {
    segment?: SegmentOptions;
  }
}

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale);

// Define plugin options type
interface LoopOverlayOptions {
  loopStart?: number;
  loopEnd?: number;
  isUserRecording?: boolean;
}

// Extend Chart.js types to include our plugins and custom properties
declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends keyof ChartTypeRegistry> {
    loopOverlay?: LoopOverlayOptions;
    playbackIndicator?: { playbackTime?: number };
    marginIndicator?: { showLeftMargin?: boolean; showRightMargin?: boolean };
  }
  
  // Add custom properties we attach to the chart instance
  interface Chart {
    setViewRange?: (range: { min: number; max: number }) => void;
    zoomStateRef?: React.RefObject<{ min: number; max: number }>;
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
  onViewChange?: (startTime: number, endTime: number, loopStart?: number, loopEnd?: number) => void;
  showNavigationHints?: boolean;
  totalDuration?: number;
  initialViewDuration?: number;
  isUserRecording?: boolean;
  yAxisConfig?: {
    beginAtZero?: boolean;
    suggestedMin?: number;
    suggestedMax?: number;
    ticks?: {
      stepSize?: number;
      precision?: number;
    };
  };
  isJumpingToPlayback?: boolean;
}

export type PitchGraphChartRef = Chart<'line', (number | null)[], number> | null;

const PitchGraphWithControls = (props: PitchGraphWithControlsProps) => {
  // NOTE: This component intentionally ignores the yFit prop and maintains a fixed y-axis range of 50-500 Hz
  // for consistent pitch visualization across different recordings.
  // The range will only expand if actual pitch values exceed these limits.
  // This is by design to allow easier comparison between different voice recordings.
  
  const {
    times,
    pitches,
    label = 'Pitch (Hz)',
    color = '#1976d2',
    loopStart,
    loopEnd,
    yFit, // This prop is intentionally not used directly, see the comment above
    playbackTime = undefined,
    onChartReady,
    onLoopChange,
    onViewChange,
    showNavigationHints = false,
    totalDuration,
    initialViewDuration,
    isUserRecording = false,
    yAxisConfig,
    isJumpingToPlayback = false,
  } = props;
  
  const chartRef = useRef<Chart<'line', (number | null)[], number> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Start with the default pitch range we want
  const [yRange, setYRange] = useState<[number, number]>([50, 500]);
  
  // Create a ref for the drag controller
  const dragControllerRef = useRef<DragController | null>(null);

  // Add a ref to preserve the loop region independently of chart state
  const preservedLoopRef = useRef<{ start: number; end: number }>({ 
    start: loopStart ?? 0, 
    end: loopEnd ?? 0 
  });

  // Update preserved loop values when props change
  useEffect(() => {
    if (loopStart !== undefined && loopEnd !== undefined) {
      preservedLoopRef.current = { start: loopStart, end: loopEnd };
    }
  }, [loopStart, loopEnd]);

  // Track user interaction state
  const isUserInteractingRef = useRef(false);

  // Track mouse position for margin indicators
  const [showLeftMargin, setShowLeftMargin] = useState(false);
  const [showRightMargin, setShowRightMargin] = useState(false);

  // Calculate xMax only when times changes
  const xMax = useMemo(() => {
    return totalDuration || (times.length > 0 ? times[times.length - 1] : 1);
  }, [times, totalDuration]);

  // Track the total available range (either from loaded data or known total duration)
  const [totalDataRange, setTotalDataRange] = useState<{ min: number; max: number }>({ 
    min: 0, 
    max: totalDuration || (times.length > 0 ? times[times.length - 1] : 1)
  });

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

  // Move device detection to a memoized value that's computed once
  const isMobile = useMemo(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)').matches;
    const touchScreen = 'ontouchstart' in window;
    const touchPoints = navigator.maxTouchPoints > 0;
    const userAgent = navigator.userAgent.toLowerCase();
    
    // Check if it's actually a mobile device
    const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    
    // Consider it mobile if:
    // 1. Screen size is mobile-like OR
    // 2. It's actually a mobile device (based on userAgent)
    const isActuallyMobile = mediaQuery || isMobileDevice;
    
    console.log('[PitchGraph] Device detection:', {
      mediaQuery,
      touchScreen,
      touchPoints,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgent,
      isMobileDevice,
      isActuallyMobile
    });
    
    return isActuallyMobile;
  }, []); // Empty dependency array means this only runs once on mount

  useEffect(() => {
    console.log('[PitchGraph] Device type:', isMobile ? 'mobile' : 'desktop');
  }, [isMobile]);

  // Add a ref to track the last loop values to prevent unnecessary updates
  const lastLoopValuesRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Memoize options without zoom plugin
  const options = useMemo(() => {
    // Store current loop values
    lastLoopValuesRef.current = {
      start: loopStart ?? 0,
      end: loopEnd ?? 0
    };

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
          enabled: !isMobile,
        },
        loopOverlay: { 
          // Only set loop values if not a user recording
          loopStart: isUserRecording ? 0 : Math.min(loopStart || 0, totalDataRange.max), 
          loopEnd: isUserRecording ? 0 : Math.min(loopEnd || 0, totalDataRange.max),
          isUserRecording // Pass this flag to the plugin
        },
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
          max: Math.min(zoomStateRef.current.max, totalDataRange.max),
          grace: 0,
          bounds: 'data' as const,
          offset: false,
          grid: {
            offset: false
          }
        },
        y: {
          title: { display: false },
          ticks: { 
            font: { size: 10 },
            // Apply custom ticks configuration if provided
            ...(yAxisConfig?.ticks || {})
          },
          min: yRange[0],
          max: yRange[1],
          // Apply other y-axis configurations if provided
          beginAtZero: yAxisConfig?.beginAtZero,
          suggestedMin: yAxisConfig?.suggestedMin,
          suggestedMax: yAxisConfig?.suggestedMax,
          grid: {
          },
        },
      },
      elements: {
        line: { 
          tension: 0.3,  // Moderate tension for smooth curves
          capBezierPoints: true  // Improve curve quality at endpoints
        },
      },
    });
  }, [xMax, yRange, loopStart, loopEnd, showLeftMargin, showRightMargin, zoomStateRef.current.min, zoomStateRef.current.max, isMobile, totalDataRange.max, yAxisConfig, isUserRecording]);

  // Add effect to ensure loop region is properly reflected in chart options
  useEffect(() => {
    if (chartRef.current?.options.plugins?.loopOverlay) {
      const currentLoopStart = chartRef.current.options.plugins.loopOverlay.loopStart ?? 0;
      const currentLoopEnd = chartRef.current.options.plugins.loopOverlay.loopEnd ?? 0;
      
      // Only update if values have changed significantly and not a user recording
      if (!isUserRecording && (
          Math.abs(currentLoopStart - (loopStart ?? 0)) > 0.001 || 
          Math.abs(currentLoopEnd - (loopEnd ?? 0)) > 0.001)) {
        chartRef.current.options.plugins.loopOverlay = {
          loopStart: loopStart ?? 0,
          loopEnd: loopEnd ?? 0,
          isUserRecording
        };
        chartRef.current.update('none');
      }
    }
  }, [loopStart, loopEnd, isUserRecording]);

  // Initialize drag controller when chart is ready
  useEffect(() => {
    if (chartRef.current && onLoopChange) {
      dragControllerRef.current = new DragController({
        chart: chartRef.current,
        onLoopChange: (start, end) => {
          // Store in our ref first
          preservedLoopRef.current = { start, end };
          
          // Then update the chart
          if (chartRef.current?.options.plugins?.loopOverlay) {
            chartRef.current.options.plugins.loopOverlay = {
              loopStart: start,
              loopEnd: end
            };
            chartRef.current.update('none');
          }
          
          // Notify parent if callback exists
          if (onLoopChange) {
            onLoopChange(start, end);
          }
        },
        loopStart: preservedLoopRef.current.start,
        loopEnd: preservedLoopRef.current.end,
        marginThresholdPixels: 40,
        maxDragLimit: totalDuration || totalDataRange.max,
        onDragStart: () => {
          // Disable pan/zoom while dragging
          isPanningRef.current = false;
          isZoomingRef.current = false;
          lastMouseXRef.current = null;
        }
      });
    }
  }, [chartRef.current]);

  // Update drag controller values when props change
  useEffect(() => {
    if (dragControllerRef.current) {
      dragControllerRef.current.updateValues({
        chart: chartRef.current,
        onLoopChange: (start, end) => {
          // Store in our ref first
          preservedLoopRef.current = { start, end };
          
          // Then update the chart
          if (chartRef.current?.options.plugins?.loopOverlay) {
            chartRef.current.options.plugins.loopOverlay = {
              loopStart: start,
              loopEnd: end
            };
            chartRef.current.update('none');
          }
          
          // Notify parent if callback exists
          if (onLoopChange) {
            onLoopChange(start, end);
          }
        },
        loopStart: preservedLoopRef.current.start,
        loopEnd: preservedLoopRef.current.end,
        maxDragLimit: totalDuration || totalDataRange.max,
        onDragStart: () => {
          // Disable pan/zoom while dragging
          isPanningRef.current = false;
          isZoomingRef.current = false;
          lastMouseXRef.current = null;
        }
      });
    }
  }, [chartRef.current, onLoopChange, loopStart, loopEnd, totalDuration, totalDataRange.max]);

  // Expose the setViewRange function on the chart instance
  useEffect(() => {
    if (chartRef.current && onChartReady) {
      // Only set up once to prevent multiple calls
      if (!chartRef.current.setViewRange) {
        console.log('[PitchGraph] Exposing functions on chart instance');
        
        // Expose our internal state setter on the chart instance
        chartRef.current.setViewRange = (range: { min: number; max: number }) => {
          console.log('[PitchGraph] External setViewRange called:', range);
          zoomStateRef.current = range;
          setViewRange(range);
          
          // Update chart if it exists
          if (chartRef.current && chartRef.current.options.scales?.x) {
            chartRef.current.options.scales.x.min = range.min;
            chartRef.current.options.scales.x.max = range.max;
            chartRef.current.update();
          }
        };
        
        // Expose our zoom state ref for direct access in emergencies
        chartRef.current.zoomStateRef = zoomStateRef;
        
        // Notify parent the chart is ready
        onChartReady(chartRef.current);
      }
    }
  }, [chartRef.current, onChartReady]);

  useEffect(() => {
    // Always use a fixed range of 50-500 Hz, only expanding if values exceed it
    // Ignore yFit from props for consistent display
    const validPitches = pitches.filter((p) => p !== null) as number[];
    if (validPitches.length > 0) {
      // Find the minimum and maximum pitch values
      let minPitch = Math.min(...validPitches);
      let maxPitch = Math.max(...validPitches);
      
      // Fixed range constants
      const DEFAULT_MIN_PITCH = 50; // Default minimum (Hz)
      const DEFAULT_MAX_PITCH = 500; // Default maximum (Hz)
      
      // Only adjust the range if values are outside the default range
      // For minimum: use lower of DEFAULT_MIN_PITCH or actual min pitch (if it's lower)
      // For maximum: use higher of DEFAULT_MAX_PITCH or actual max pitch (if it's higher)
      minPitch = Math.min(DEFAULT_MIN_PITCH, Math.floor(minPitch)); 
      maxPitch = Math.max(DEFAULT_MAX_PITCH, Math.ceil(maxPitch));
      
      // Round to create clean values
      minPitch = Math.floor(minPitch / 10) * 10;
      maxPitch = Math.ceil(maxPitch / 10) * 10;
      
      console.log('[PitchGraph] Setting fixed y-axis range:', { minPitch, maxPitch, actualMin: Math.min(...validPitches), actualMax: Math.max(...validPitches), yFitIgnored: yFit });
      setYRange([minPitch, maxPitch]);
    } else {
      // No valid pitches, use default fixed range
      console.log('[PitchGraph] No valid pitches, using default range: [50, 500]', { yFitIgnored: yFit });
      setYRange([50, 500]);
    }
  }, [pitches]); // Removed yFit from dependencies to prevent it from triggering updates

  // Add an effect to enforce y-axis range (ignoring yFit)
  useEffect(() => {
    if (yFit) {
      console.log('[PitchGraph] Ignoring provided yFit range:', yFit, 'using fixed range instead');
    }
  }, [yFit]);

  // Add an effect to update the chart whenever yRange changes
  useEffect(() => {
    if (chartRef.current && chartRef.current.options.scales?.y) {
      console.log('[PitchGraph] Applying y-axis range to chart:', yRange);
      
      chartRef.current.options.scales.y.min = yRange[0];
      chartRef.current.options.scales.y.max = yRange[1];
      
      // Force an update of the chart
      chartRef.current.update('none');
    }
  }, [yRange]);

  // Add a ref to track the actual total range
  const actualTotalRangeRef = useRef<number>(1);

  // Modify handleResetZoom to use isUserRecording
  const handleResetZoom = () => {
    if (!chartRef.current) return;
    
    // Always show the full range for user recordings
    // and respect initialViewDuration only for longer native recordings
    const shouldUseFullRange = isUserRecording || !initialViewDuration || totalDataRange.max <= 20;
    
    const resetRange = shouldUseFullRange ? {
      min: 0,
      max: totalDataRange.max
    } : {
      min: 0,
      max: Math.min(initialViewDuration || totalDataRange.max, totalDataRange.max)
    };
    
    console.log('[PitchGraph] Resetting zoom:', {
      resetRange,
      initialViewDuration: initialViewDuration,
      totalRange: totalDataRange,
      shouldUseFullRange,
      timePointsCount: times.length,
      isUserRecording,
      totalDataRangeMax: totalDataRange.max,
      actualTotalRange: actualTotalRangeRef.current
    });

    // Update zoom state
    zoomStateRef.current = resetRange;
    setViewRange(resetRange);

    // Update chart scales
    if (chartRef.current.options.scales?.x) {
      chartRef.current.options.scales.x.min = resetRange.min;
      chartRef.current.options.scales.x.max = resetRange.max;
    }
    chartRef.current.update('none');

    // Notify parent of view change
    if (onViewChange) {
      onViewChange(resetRange.min, resetRange.max);
    }
  };

  // Update the useEffect that handles totalDataRange updates to use isUserRecording
  useEffect(() => {
    // Use totalDuration as the source of truth if available
    const newMax = totalDuration || (times.length > 0 ? times[times.length - 1] : 1);
    
    // Get the current chart view range
    const currentViewMin = chartRef.current?.scales?.x?.min ?? 0;
    const currentViewMax = chartRef.current?.scales?.x?.max ?? newMax;
    
    // Determine if this is an initial load by checking if chart view range is at default (0 to small value)
    // This avoids unwanted resets during regular playback after the chart is already set up
    const isInitialLoadOrReset = currentViewMax <= 10 && currentViewMin === 0;
    
    console.log('[PitchGraph] Updating total data range:', {
        oldRange: totalDataRange,
        newMax,
        dataPoints: times.length,
        totalDuration,
        lastTimePoint: times.length > 0 ? times[times.length - 1] : null,
        isUserInteracting: isUserInteractingRef.current,
        currentZoomState: { ...zoomStateRef.current },
        isUserRecording,
        isJumpingToPlayback,
        currentView: { min: currentViewMin, max: currentViewMax },
        isInitialLoadOrReset,
        explicitLastPoint: times[times.length - 1]
    });
    
    // Update the actual total range ref
    actualTotalRangeRef.current = newMax;
    
    // Only update view range if: 
    // 1. This is a user recording (always show full range) OR
    // 2. This is an initial load/reset AND
    //    - This is NOT a jump-to-playback operation AND
    //    - The user is not actively interacting with the chart AND
    //    - For short recordings <= 20s: show full range
    //    - For long native recordings: respect initialViewDuration
    if (isUserRecording || (isInitialLoadOrReset && !isJumpingToPlayback && !isUserInteractingRef.current)) {
      const updatedRange = isUserRecording || (!initialViewDuration && newMax <= 20) ? {
        min: 0,
        max: newMax
      } : initialViewDuration ? {
        min: 0,
        max: Math.min(initialViewDuration, newMax)
      } : {
        min: 0,
        max: newMax
      };
      
      console.log('[PitchGraph] Setting initial view range:', {
        updatedRange,
        initialViewDuration,
        totalDuration: newMax,
        isUserRecording,
        isJumpingToPlayback,
        timePointsCount: times.length,
        finalRangeMin: updatedRange.min,
        finalRangeMax: updatedRange.max
      });
      
      // Only if not jumping to playback position and this is an initial load
      if (!isJumpingToPlayback && isInitialLoadOrReset) {
        setTotalDataRange({ min: 0, max: newMax });
        zoomStateRef.current = { ...updatedRange };
        setViewRange(updatedRange);
        
        // If we have a chart, update it directly too
        if (chartRef.current && chartRef.current.options.scales?.x) {
          console.log('[PitchGraph] Directly setting chart scales:', {
            min: updatedRange.min,
            max: updatedRange.max,
            totalDataRangeMax: newMax
          });
          
          chartRef.current.options.scales.x.min = updatedRange.min;
          chartRef.current.options.scales.x.max = updatedRange.max;
          chartRef.current.update('none');
        }
      } else {
        console.log('[PitchGraph] Skipping view range reset: not initial load or jump in progress');
        // Still update the total data range, but don't change the view
        setTotalDataRange({ min: 0, max: newMax });
      }
    } else {
      console.log('[PitchGraph] Skipping initial view setup, already viewing content or user is interacting');
      setTotalDataRange({ min: 0, max: newMax });
    }
  }, [times, totalDuration, initialViewDuration, isUserRecording, isJumpingToPlayback]);

  // Modify handleWheel to remove artificial view range limits for user recordings
  const handleWheel = (e: WheelEvent) => {
    const chart = chartRef.current;
    if (!chart || dragControllerRef.current?.isDragging()) return;

    e.preventDefault();
    isUserInteractingRef.current = true;
    isZoomingRef.current = true;
    
    // Get current loop values from our ref, not from the chart
    const currentLoopStart = preservedLoopRef.current.start;
    const currentLoopEnd = preservedLoopRef.current.end;
    
    const { min: currentMin, max: currentMax } = zoomStateRef.current;
    const mouseX = e.offsetX;
    
    // Calculate the data value at mouse position
    const xScale = chart.scales.x;
    if (!xScale || typeof xScale.getValueForPixel !== 'function') return;
    
    const mouseDataX = xScale.getValueForPixel(mouseX);
    if (mouseDataX === undefined) return;
    
    // Calculate zoom factor
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    // Calculate new range while keeping mouse position fixed
    const currentRange = currentMax - currentMin;
    let newRange = currentRange * zoomFactor;
    
    // Enforce minimum (0.5s) view range
    const minViewRange = 0.5;
    
    // Don't enforce an arbitrary maximum for user recordings
    // Only enforce a maximum for longer native recordings
    const isLongNativeRecording = initialViewDuration !== undefined && totalDataRange.max > 30;
    const maxViewRange = isLongNativeRecording ? 
      Math.min(20, totalDuration || totalDataRange.max) : // Limit to 20s for long native recordings
      totalDuration || totalDataRange.max; // No limit for user recordings
    
    // Don't allow zooming out beyond maximum view range
    if (newRange > maxViewRange) {
      // If already at max range, don't do anything
      if (Math.abs(currentRange - maxViewRange) < 0.01) return;
      
      // Otherwise, limit to max range
      newRange = maxViewRange;
      console.log('[PitchGraph] Limiting zoom out to maximum view range:', maxViewRange);
    }
    
    // Don't allow zooming in beyond minimum view range
    if (newRange < minViewRange) return;

    // Calculate how far the mouse is between the left and right edge (0 to 1)
    const mouseRatio = (mouseDataX - currentMin) / currentRange;
    
    // Apply the zoom around the mouse position
    let newMin = mouseDataX - (mouseRatio * newRange);
    let newMax = mouseDataX + ((1 - mouseRatio) * newRange);

    // Adjust if we go out of bounds
    if (newMin < 0) {
      newMax += Math.abs(newMin);
      newMin = 0;
    }
    
    const absoluteMaxRange = totalDuration || totalDataRange.max;
    if (newMax > absoluteMaxRange) {
      newMin = Math.max(0, newMin - (newMax - absoluteMaxRange));
      newMax = absoluteMaxRange;
    }

    // Update zoom state
    zoomStateRef.current = { min: newMin, max: newMax };
    
    // Update chart scales
    if (chart.options.scales?.x) {
      chart.options.scales.x.min = newMin;
      chart.options.scales.x.max = newMax;
    }
    
    // Always restore the loop region with the preserved values
    if (chart.options.plugins?.loopOverlay) {
      chart.options.plugins.loopOverlay = {
        loopStart: preservedLoopRef.current.start,
        loopEnd: preservedLoopRef.current.end
      };
    }
    
    chart.update('none');
    
    // Notify parent of view change, passing the preserved loop values
    if (onViewChange) {
      onViewChange(newMin, newMax, currentLoopStart, currentLoopEnd);
    }

    // Reset interaction flags after a short delay
    setTimeout(() => {
      isZoomingRef.current = false;
      isUserInteractingRef.current = false;
    }, 100);
  };

  // Modify handleMouseMove for panning
  const handleMouseMove = (e: MouseEvent) => {
    const chart = chartRef.current;
    if (!chart || !lastMouseXRef.current || !isPanningRef.current || dragControllerRef.current?.isDragging()) return;

    // Get loop values from our ref, not from the chart
    const currentLoopStart = preservedLoopRef.current.start;
    const currentLoopEnd = preservedLoopRef.current.end;

    const { min: currentMin, max: currentMax } = zoomStateRef.current;
    const currentRange = currentMax - currentMin;
    const maxRange = actualTotalRangeRef.current;
    
    // Double check we're not somehow panning while fully zoomed out
    // or have an invalid zoom state
    if (currentRange >= maxRange || 
        currentRange <= 0 || 
        currentMin < 0 ||
        currentMax > maxRange) {
        // Reset to safe state
        isPanningRef.current = false;
        lastMouseXRef.current = null;
        
        // If we're in an invalid state, reset the view
        if (currentRange <= 0 || currentMin < 0 || currentMax > maxRange) {
            const safeRange = { min: 0, max: maxRange };
            zoomStateRef.current = safeRange;
            setViewRange(safeRange);
            if (chart.options.scales?.x) {
                chart.options.scales.x.min = safeRange.min;
                chart.options.scales.x.max = safeRange.max;
            }
            chart.update('none');
            if (onViewChange) {
                onViewChange(safeRange.min, safeRange.max, currentLoopStart, currentLoopEnd);
            }
        }
        return;
    }

    const mouseX = e.offsetX;
    const dx = mouseX - lastMouseXRef.current;
    const xScale = chart.scales.x;
    const pixelsPerUnit = (chart.chartArea.right - chart.chartArea.left) / (xScale.max - xScale.min);
    const deltaX = dx / pixelsPerUnit;
    
    // Calculate new min/max positions
    let newMin = currentMin - deltaX;
    let newMax = currentMax - deltaX;

    // Prevent panning beyond bounds
    if (newMin < 0) {
        newMin = 0;
        newMax = currentRange;
    } else if (newMax > maxRange) {
        newMax = maxRange;
        newMin = Math.max(0, newMax - currentRange);
    }

    // Only update if we actually moved and the new range is valid
    if (newMin !== currentMin || newMax !== currentMax) {
        zoomStateRef.current = { min: newMin, max: newMax };
        setViewRange({ min: newMin, max: newMax });
        lastMouseXRef.current = mouseX;

        // Update chart scales
        if (chart.options.scales?.x) {
            chart.options.scales.x.min = newMin;
            chart.options.scales.x.max = newMax;
        }
        
        // Always restore the loop region with preserved values
        if (chart.options.plugins?.loopOverlay) {
            chart.options.plugins.loopOverlay = {
                loopStart: currentLoopStart,
                loopEnd: currentLoopEnd
            };
        }
        
        chart.update('none');

        // Notify parent of view change, passing the preserved loop values
        if (onViewChange) {
          onViewChange(newMin, newMax, currentLoopStart, currentLoopEnd);
        }
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && !dragControllerRef.current?.isDragging()) { // Left click only
        // Check if we're fully zoomed out before allowing pan to start
        const currentRange = zoomStateRef.current.max - zoomStateRef.current.min;
        const maxRange = actualTotalRangeRef.current;
        
        console.log('[PitchGraph] Pan attempt:', {
            currentRange,
            maxRange,
            zoomState: { ...zoomStateRef.current },
            totalRange: { ...totalDataRange },
            actualTotalRange: actualTotalRangeRef.current,
            diff: Math.abs(currentRange - maxRange),
            isZoomedOut: currentRange >= maxRange
        });

        // Only start panning if we're zoomed in (with some small tolerance for floating point comparison)
        // and the current view range is valid
        if (currentRange < maxRange && 
            currentRange > 0 && 
            zoomStateRef.current.min >= 0 &&
            zoomStateRef.current.max <= maxRange) {
            console.log('[PitchGraph] Starting pan');
            isPanningRef.current = true;
            lastMouseXRef.current = e.offsetX;
        } else {
            console.log('[PitchGraph] Pan prevented - fully zoomed out or invalid range');
        }
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
      
      // Get current loop values from our ref, not from the chart
      const currentLoopStart = preservedLoopRef.current.start;
      const currentLoopEnd = preservedLoopRef.current.end;
      
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
      const finalMax = Math.min(totalDataRange.max, Math.max(finalMin + 0.5, newMax));
      
      // Update zoom state
      zoomStateRef.current = { min: finalMin, max: finalMax };
      
      // Update chart scales
      if (chart.options.scales?.x) {
        chart.options.scales.x.min = finalMin;
        chart.options.scales.x.max = finalMax;
      }
      
      // Always restore the loop region with preserved values
      if (chart.options.plugins?.loopOverlay) {
        chart.options.plugins.loopOverlay = {
          loopStart: preservedLoopRef.current.start,
          loopEnd: preservedLoopRef.current.end
        };
      }
      
      // Update view range
      setViewRange({ min: finalMin, max: finalMax });
      
      // Update chart
      chart.update('none');
      
      // Notify parent of view change with preserved loop values
      if (onViewChange) {
        onViewChange(finalMin, finalMax, currentLoopStart, currentLoopEnd);
      }
      
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
      
      // Get current loop values from our ref, not from the chart
      const currentLoopStart = preservedLoopRef.current.start;
      const currentLoopEnd = preservedLoopRef.current.end;
      
      const deltaX = touch.clientX - touchPanRef.current.x;
      
      const xScale = chart.scales.x;
      if (!xScale?.getValueForPixel) return;
      
      const value0 = xScale.getValueForPixel(0);
      const valueDx = xScale.getValueForPixel(deltaX);
      if (value0 === undefined || valueDx === undefined) return;
      
      const deltaValue = valueDx - value0;
      
      const { min: currentMin, max: currentMax } = zoomStateRef.current;
      const currentRange = currentMax - currentMin;
      
      // Calculate new positions
      let newMin = currentMin - deltaValue;
      let newMax = currentMax - deltaValue;
      
      // Prevent panning beyond bounds
      if (newMin < 0) {
        // If trying to pan beyond left edge, lock to 0
        newMin = 0;
        newMax = currentRange;
      } else if (newMax > totalDataRange.max) {
        // If trying to pan beyond right edge, lock to max
        newMax = totalDataRange.max;
        newMin = newMax - currentRange;
      }
      
      // Update zoom state
      zoomStateRef.current = { min: newMin, max: newMax };
      
      // Update chart scales
      if (chart.options.scales?.x) {
        chart.options.scales.x.min = newMin;
        chart.options.scales.x.max = newMax;
      }
      
      // Always restore the loop region with preserved values
      if (chart.options.plugins?.loopOverlay) {
        chart.options.plugins.loopOverlay = {
          loopStart: preservedLoopRef.current.start,
          loopEnd: preservedLoopRef.current.end
        };
      }
      
      // Update view range
      setViewRange({ min: newMin, max: newMax });
      
      // Update chart
      chart.update('none');
      
      // Notify parent of view change with preserved loop values
      if (onViewChange) {
        onViewChange(newMin, newMax, currentLoopStart, currentLoopEnd);
      }
      
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

  const chartData = useMemo(() => {
    // Create a modified version of pitch data that has interpolated values over gaps
    // This will create a smooth curve with color changes
    const smoothedData: (number | null)[] = [...pitches];
    
    // Define a minimum threshold for voiced speech - frequencies below this are likely unvoiced
    const VOICED_THRESHOLD = 85; // Hz - typical minimum for human voice
    
    // Create an array to track which segments are actually voiced
    // Both null values AND values below threshold are considered unvoiced
    const isVoiced = pitches.map(p => p !== null && p > VOICED_THRESHOLD);
    
    // Find gaps between voiced sections and interpolate values across them
    for (let i = 0; i < pitches.length; i++) {
      // If the current point is null or below threshold but we need a value for display
      if (!isVoiced[i]) {
        // Look for previous voiced segment
        let prevVoicedIdx = -1;
        let prevVoicedValue = null;
        for (let j = i - 1; j >= 0; j--) {
          if (isVoiced[j]) {
            prevVoicedIdx = j;
            prevVoicedValue = pitches[j];
            break;
          }
        }
        
        // Look for next voiced segment
        let nextVoicedIdx = -1;
        let nextVoicedValue = null;
        for (let j = i + 1; j < pitches.length; j++) {
          if (isVoiced[j]) {
            nextVoicedIdx = j;
            nextVoicedValue = pitches[j];
            break;
          }
        }
        
        // If we found voiced segments on both sides, interpolate
        if (prevVoicedIdx !== -1 && nextVoicedIdx !== -1) {
          const gapSize = nextVoicedIdx - prevVoicedIdx;
          const progress = (i - prevVoicedIdx) / gapSize;
          smoothedData[i] = prevVoicedValue! + (nextVoicedValue! - prevVoicedValue!) * progress;
        } 
        // If only found previous voiced segment, maintain its value
        else if (prevVoicedIdx !== -1) {
          smoothedData[i] = prevVoicedValue;
        }
        // If only found next voiced segment, maintain its value
        else if (nextVoicedIdx !== -1) {
          smoothedData[i] = nextVoicedValue;
        }
        // If no voiced segments found, use a fallback value
        else {
          smoothedData[i] = VOICED_THRESHOLD; // Default to threshold value 
        }
      }
    }
    
    // Now we'll track voiced/unvoiced segments using our enhanced detection
    const segmentInfo = smoothedData.map((_, i) => ({
      value: smoothedData[i],
      isVoiced: isVoiced[i] // Use our enhanced voiced detection
    }));

    return {
      labels: times,
      datasets: [
        {
          label,
          data: smoothedData,
          borderColor: color,  // Use a single color for the main line
          backgroundColor: 'rgba(25, 118, 210, 0.1)',
          spanGaps: true,  // Connect across gaps for smooth line
          pointRadius: 0,
          borderWidth: 3,  // Thicker lines for better visibility
          tension: 0.3,    // Moderate curve tension for smooth lines
          // Store the voicing information for our custom renderer
          segment: {
            borderColor: (ctx: SegmentContext) => segmentInfo[ctx.p1DataIndex]?.isVoiced ? color : '#ff6b6b',
            borderDash: (ctx: SegmentContext) => segmentInfo[ctx.p1DataIndex]?.isVoiced ? [] : [5, 5]
          }
        },
      ],
    };
  }, [times, pitches, color, label]);

  // Create custom segment coloring plugin to handle different colors for voiced/unvoiced segments
  const segmentColoringPlugin: Plugin<'line'> = {
    id: 'segmentColoring',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      
      if (!meta.data || meta.data.length === 0) return;
      
      // Use a more specific type for the dataset
      const dataset = chart.data.datasets[0] as unknown as {
        borderWidth?: number;
        segment?: SegmentOptions;
      };
      const segmentOptions = dataset.segment;
      if (!segmentOptions) return;
      
      // Save original line settings
      ctx.save();
      
      // For each segment between points
      for (let i = 0; i < meta.data.length - 1; i++) {
        // Get current point and next point
        const current = meta.data[i];
        const next = meta.data[i + 1];
        
        if (!current || !next) continue;
        
        // Use segment options to determine color and dash pattern
        const segmentContext: SegmentContext = { p1DataIndex: i, p2DataIndex: i + 1 };
        const color = typeof segmentOptions.borderColor === 'function' 
          ? segmentOptions.borderColor(segmentContext) 
          : segmentOptions.borderColor;
        
        const borderDash = typeof segmentOptions.borderDash === 'function'
          ? segmentOptions.borderDash(segmentContext)
          : segmentOptions.borderDash;
        
        if (!color) continue;
        
        // Draw line segment with specific color and dash
        ctx.beginPath();
        ctx.moveTo(current.x, current.y);
        ctx.lineTo(next.x, next.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = dataset.borderWidth || 3;
        
        if (borderDash && borderDash.length) {
          ctx.setLineDash(borderDash);
        } else {
          ctx.setLineDash([]);
        }
        
        ctx.stroke();
      }
      
      // Restore original context
      ctx.restore();
    }
  };

  // Overlay plugin for loop region
  const loopOverlayPlugin: Plugin<'line'> = {
    id: 'loopOverlay',
    beforeDatasetsDraw: (chart: Chart) => {
      const options = chart.options.plugins?.loopOverlay;
      if (!options) return;
      
      // Check both the options flag and the component prop to be sure
      if (options.isUserRecording || isUserRecording) return;
      
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

  // Add ref to track if we've done initial setup
  const hasInitializedRef = useRef(false);

  // Reset hasInitializedRef when user recording changes
  useEffect(() => {
    if (isUserRecording) {
      console.log('[PitchGraph] User recording detected, resetting initialization flag');
      hasInitializedRef.current = false;
    }
  }, [isUserRecording, times.length]);

  // Modify auto-reset zoom to only trigger on initial load
  useEffect(() => {
    if (!hasInitializedRef.current && times.length > 0) {
      console.log('[PitchGraph] Initial load detected, resetting zoom');
      handleResetZoom();
      hasInitializedRef.current = true;
    }
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

  // Update playback time without recalculating options
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart?.options?.plugins) return;

    // Store playback time in ref
    playbackTimeRef.current = playbackTime ?? 0;
    
    // During drag, use visual values from the drag controller
    if (dragControllerRef.current?.isDragging()) {
      const visualValues = dragControllerRef.current.getVisualValues();
      chart.options.plugins.loopOverlay = {
        loopStart: visualValues.start,
        loopEnd: visualValues.end
      };
      
      // Also update our preserved ref to match the dragged values
      preservedLoopRef.current = {
        start: visualValues.start,
        end: visualValues.end
      };
    } else {
      // Make sure loop overlay always has the correct values from our ref
      chart.options.plugins.loopOverlay = {
        loopStart: preservedLoopRef.current.start,
        loopEnd: preservedLoopRef.current.end
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
  }, [playbackTime, loopStart, loopEnd]);

  // Add back the useEffect for handling view range changes and notifying parent
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
      {showNavigationHints && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
          fontSize: '0.8rem',
          color: '#666',
        }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {isMobile ? (
              <>
                <span>🤏 Pinch to zoom</span>
                <span>👆 Drag to pan</span>
              </>
            ) : (
              <>
                <span>🖱️ Mouse wheel to zoom</span>
                <span>👆 Drag to pan</span>
              </>
            )}
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
      )}

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
        <Line 
          ref={chartRef} 
          data={chartData} 
          options={{
            ...options,
            layout: {
              padding: {
                right: 30
              }
            }
          }} 
          plugins={[
            loopOverlayPlugin, 
            playbackIndicatorPlugin, 
            marginIndicatorPlugin,
            segmentColoringPlugin,
            {
              id: 'gradientOverlay',
              afterDraw: (chart) => {
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                
                if (zoomStateRef.current.max < xMax) {
                  // Right gradient
                  const gradientRight = ctx.createLinearGradient(
                    chartArea.right - 50, 
                    0, 
                    chartArea.right, 
                    0
                  );
                  gradientRight.addColorStop(0, 'rgba(255,255,255,0)');
                  gradientRight.addColorStop(1, 'rgba(25, 118, 210, 0.15)');
                  
                  ctx.fillStyle = gradientRight;
                  ctx.fillRect(
                    chartArea.right - 50,
                    chartArea.top,
                    50,
                    chartArea.bottom - chartArea.top
                  );
                }
                
                if (zoomStateRef.current.min > 0) {
                  // Left gradient
                  const gradientLeft = ctx.createLinearGradient(
                    chartArea.left, 
                    0, 
                    chartArea.left + 50, 
                    0
                  );
                  gradientLeft.addColorStop(0, 'rgba(25, 118, 210, 0.15)');
                  gradientLeft.addColorStop(1, 'rgba(255,255,255,0)');
                  
                  ctx.fillStyle = gradientLeft;
                  ctx.fillRect(
                    chartArea.left,
                    chartArea.top,
                    50,
                    chartArea.bottom - chartArea.top
                  );
                }
              }
            }
          ]} 
        />
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