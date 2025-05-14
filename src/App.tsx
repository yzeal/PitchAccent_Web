import React, { useState, useRef, useCallback } from 'react'
import Footer from './components/Footer'
import Recorder from './components/Recorder'
import PitchGraphWithControls from './components/PitchGraph'
import type { Chart } from 'chart.js';
import './App.css'
import { PitchDetector } from 'pitchy'
import { PitchDataManager } from './services/PitchDataManager'

// Median filter for smoothing
function medianFilter(arr: (number | null)[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < arr.length; i++) {
    const window: number[] = []
    for (let j = Math.max(0, i - Math.floor(windowSize / 2)); j <= Math.min(arr.length - 1, i + Math.floor(windowSize / 2)); j++) {
      if (arr[j] !== null && !isNaN(arr[j]!)) window.push(arr[j]!)
    }
    if (window.length > 0) {
      window.sort((a, b) => a - b)
      result.push(window[Math.floor(window.length / 2)])
    } else {
      result.push(null)
    }
  }
  return result
}

const MIN_PITCH = 60
const MAX_PITCH = 500
const MIN_CLARITY = 0.8
const MEDIAN_FILTER_SIZE = 5

// Type definitions
interface AudioContextType extends AudioContext {
  decodeAudioData: (arrayBuffer: ArrayBuffer) => Promise<AudioBuffer>;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// Add extended chart type with our custom methods
interface ExtendedChart extends Chart<'line', (number | null)[], number> {
  setViewRange?: (range: { min: number; max: number }) => void;
  zoomStateRef?: React.RefObject<{ min: number; max: number }>;
}

const App: React.FC = () => {
  // User pitch data
  const [userPitchData, setUserPitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [userAudioUrl, setUserAudioUrl] = useState<string | undefined>(undefined)

  // Native pitch data
  const [nativePitchData, setNativePitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })
  const [nativeMediaUrl, setNativeMediaUrl] = useState<string | null>(null)
  const [nativeMediaType, setNativeMediaType] = useState<'audio' | 'video' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nativeVideoRef = useRef<HTMLVideoElement>(null)
  const nativeAudioRef = useRef<HTMLAudioElement>(null)

  // Loop selection and delay state
  const [loopStart, setLoopStart] = useState(0)
  const [loopEnd, setLoopEnd] = useState(0)
  const [loopDelay, setLoopDelay] = useState(0)
  const [loopYFit, setLoopYFit] = useState<[number, number] | null>(null)

  // Native playback time tracking
  const [nativePlaybackTime, setNativePlaybackTime] = useState(0);
  const [userPlaybackTime, setUserPlaybackTime] = useState(0);
  const userAudioRef = useRef<HTMLAudioElement>(null);
  const userAudioPlayingRef = useRef(false);

  const [nativeChartInstance, setNativeChartInstance] = useState<ExtendedChart | null>(null);

  // Add drag state
  const [isDragging, setIsDragging] = useState(false);

  // Add PitchDataManager
  const pitchManager = useRef(new PitchDataManager({
    thresholdDuration: 30, // 30 seconds
    segmentDuration: 10,   // 10 second segments
    preloadSegments: 1,    // Load one segment ahead
    maxCachedSegments: 6   // Keep 6 segments in memory
  }));

  // Add a ref to track last valid user-set loop region
  const userSetLoopRef = useRef<{start: number, end: number} | null>(null);
  
  // Add a ref to track when a new file is being loaded
  const isLoadingNewFileRef = useRef<boolean>(false);

  // Add loading state for pitch data
  const [isLoadingPitchData, setIsLoadingPitchData] = useState(false);

  // Add drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Set flag to indicate we're loading a completely new file
    isLoadingNewFileRef.current = true;
    console.log('[App] Loading new file via drop, setting isLoadingNewFile flag:', isLoadingNewFileRef.current);

    // Reset user-set loop region when loading a new file
    userSetLoopRef.current = null;
    console.log('[App] New file loaded, clearing user-set loop region');

    // Use the existing file handling logic
    const url = URL.createObjectURL(file);
    setNativeMediaUrl(url);
    
    if (file.type.startsWith('audio/')) {
      setNativeMediaType('audio');
      try {
        console.log('[App] Initializing PitchDataManager with audio file:', file.name);
        await pitchManager.current.initialize(file);
        const initialData = pitchManager.current.getPitchDataForTimeRange(0, 30);
        console.log('[App] Initial pitch data loaded:', initialData);
        setNativePitchData(initialData);
      } catch (error) {
        console.error('Error processing audio:', error);
        setNativePitchData({ times: [], pitches: [] });
      }
    } else if (file.type.startsWith('video/')) {
      setNativeMediaType('video');
      try {
        console.log('[App] Initializing PitchDataManager with video file:', file.name);
        await pitchManager.current.initialize(file);
        const initialData = pitchManager.current.getPitchDataForTimeRange(0, 30);
        console.log('[App] Initial pitch data loaded:', initialData);
        setNativePitchData(initialData);
      } catch (error) {
        console.error('Error processing video:', error);
        setNativePitchData({ times: [], pitches: [] });
      }
    } else {
      setNativeMediaType(null);
      setNativePitchData({ times: [], pitches: [] });
    }
    
    // Don't reset the flag here - it will be reset by a useEffect
    console.log('[App] File loading complete, isLoadingNewFile still set:', isLoadingNewFileRef.current);
  };

  // Extract pitch from user recording when audioBlob changes
  React.useEffect(() => {
    if (!audioBlob) return;
    const extract = async () => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)() as AudioContextType;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const frameSize = 2048;
        const hopSize = 256;
        const detector = PitchDetector.forFloat32Array(frameSize);
        const pitches: (number | null)[] = [];
        const times: number[] = [];
        for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
          const frame = channelData.slice(i, i + frameSize);
          const [pitch, clarity] = detector.findPitch(frame, sampleRate);
          if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && clarity >= MIN_CLARITY) {
            pitches.push(pitch);
          } else {
            pitches.push(null);
          }
          times.push(i / sampleRate);
        }
        const smoothed = medianFilter(pitches, MEDIAN_FILTER_SIZE);
        setUserPitchData({ times, pitches: smoothed });
      } catch (error) {
        console.error('Error extracting pitch:', error);
        setUserPitchData({ times: [], pitches: [] });
      }
    };
    extract();
  }, [audioBlob]);

  // Modify handleNativeFileChange
  const handleNativeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Set flag to indicate we're loading a completely new file
    isLoadingNewFileRef.current = true;
    console.log('[App] Loading new file via input, setting isLoadingNewFile flag:', isLoadingNewFileRef.current);
    
    // Reset user-set loop region when loading a new file
    userSetLoopRef.current = null;
    console.log('[App] New file loaded, clearing user-set loop region');
    
    const url = URL.createObjectURL(file);
    setNativeMediaUrl(url);
    
    if (file.type.startsWith('audio/')) {
      setNativeMediaType('audio');
      try {
        console.log('[App] Initializing PitchDataManager with audio file:', file.name);
        await pitchManager.current.initialize(file);
        const initialData = pitchManager.current.getPitchDataForTimeRange(0, 30);
        console.log('[App] Initial pitch data loaded:', initialData);
        setNativePitchData(initialData);
      } catch (error) {
        console.error('Error processing audio:', error);
        setNativePitchData({ times: [], pitches: [] });
      }
    } else if (file.type.startsWith('video/')) {
      setNativeMediaType('video');
      try {
        console.log('[App] Initializing PitchDataManager with video file:', file.name);
        await pitchManager.current.initialize(file);
        const initialData = pitchManager.current.getPitchDataForTimeRange(0, 30);
        console.log('[App] Initial pitch data loaded:', initialData);
        setNativePitchData(initialData);
      } catch (error) {
        console.error('Error processing video:', error);
        setNativePitchData({ times: [], pitches: [] });
      }
    } else {
      setNativeMediaType(null);
      setNativePitchData({ times: [], pitches: [] });
    }
    
    // Don't reset the flag here - it will be reset by a useEffect
    console.log('[App] File loading complete, isLoadingNewFile still set:', isLoadingNewFileRef.current);
  };

  // Ensure video is seeked to 0.01 and loaded when a new video is loaded (robust for short files)
  React.useEffect(() => {
    if (nativeMediaType === 'video' && nativeVideoRef.current) {
      const video = nativeVideoRef.current;
      const onLoaded = () => {
        video.currentTime = 0.01;
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.load();
      return () => video.removeEventListener('loadedmetadata', onLoaded);
    }
  }, [nativeMediaUrl, nativeMediaType]);

  // Update loop end when native media is loaded - only if no user-set region exists
  React.useEffect(() => {
    // Only proceed with reset if we're loading a completely new file
    if (!isLoadingNewFileRef.current) {
      console.log('[App] Pitch data changed, but not loading a new file. Preserving loop region.', {
        isLoadingNewFile: isLoadingNewFileRef.current,
        pitchDataLength: nativePitchData.times.length,
        loopStart,
        loopEnd
      });
      
      // Just update the y-axis without changing the loop region
      if (nativePitchData.times.length > 0) {
        fitYAxisToLoop();
      }
      return;
    }
    
    console.log('[App] Setting loop region for newly loaded file', {
      isLoadingNewFile: isLoadingNewFileRef.current,
      pitchDataLength: nativePitchData.times.length
    });
    
    // We always want to reset the loop region when loading a new file,
    // regardless of whether the user had set a custom loop before
    // since this is a completely new file with potentially different length
    
    const duration = nativePitchData.times.length > 0 ? nativePitchData.times[nativePitchData.times.length - 1] : 0;
    
    // For long videos (>30s), set initial loop and view to first 10 seconds
    // For short videos, show the entire duration
    if (duration > 30) {
      const initialViewDuration = 10;
      setLoopStartWithLogging(0);
      setLoopEndWithLogging(initialViewDuration);
      
      // Set the user-set loop to this region, as if the user created this loop
      userSetLoopRef.current = { start: 0, end: initialViewDuration };
      console.log('[App] New file loaded (long), setting loop region to first 10 seconds:', {
        duration,
        loop: userSetLoopRef.current
      });
      
      // Update chart view range if chart is ready
      if (nativeChartInstance) {
        console.log('[App] Long video detected, setting initial view to first 10 seconds:', {
          duration,
          initialViewDuration,
          chartInstance: !!nativeChartInstance
        });
        
        // Update zoom state ref directly
        if (nativeChartInstance.options.scales?.x) {
          nativeChartInstance.options.scales.x.min = 0;
          nativeChartInstance.options.scales.x.max = initialViewDuration;
          
          // Also update the zoom state ref in the PitchGraph component
          const chartWithZoomState = nativeChartInstance as unknown as { zoomStateRef: { current: { min: number; max: number } } };
          if (chartWithZoomState.zoomStateRef) {
            chartWithZoomState.zoomStateRef.current = { min: 0, max: initialViewDuration };
          }
          
          // Force the chart to update its layout
          nativeChartInstance.update('none');
          
          // Notify parent of view change
          handleViewChange(0, initialViewDuration);
        }
      }
    } else {
      // For short videos, set loop to entire duration
      setLoopStartWithLogging(0);
      setLoopEndWithLogging(duration);
      
      // Set the user-set loop to this region, as if the user created this loop
      userSetLoopRef.current = { start: 0, end: duration };
      console.log('[App] New file loaded (short), setting loop region to entire duration:', {
        duration,
        loop: userSetLoopRef.current
      });
    }
    
    fitYAxisToLoop();
  }, [nativePitchData.times, nativeChartInstance]);

  // Add a guard to protect loop region changes from events other than user interaction
  React.useEffect(() => {
    // Always run fitYAxisToLoop when loop region changes to update visuals
    if (nativePitchData.times.length > 0) {
      console.log('[App] Loop region changed, fitting Y axis:', { 
        loopStart, 
        loopEnd, 
        source: 'loop change effect',
        userSetLoop: userSetLoopRef.current
      });
      
      // If user has set a custom loop region, but current values don't match,
      // restore the user values (this is a safety check)
      const userSetLoop = userSetLoopRef.current;
      if (userSetLoop && 
          (Math.abs(loopStart - userSetLoop.start) > 0.001 || 
           Math.abs(loopEnd - userSetLoop.end) > 0.001)) {
        
        console.log('[App] Loop region overwritten detected, restoring user values:', {
          current: {start: loopStart, end: loopEnd},
          userSet: userSetLoop
        });
        
        // Restore user values 
        setLoopStartWithLogging(userSetLoop.start);
        setLoopEndWithLogging(userSetLoop.end);
        return;
      }
      
      fitYAxisToLoop();
    }
  }, [loopStart, loopEnd]);

  // Add ref to track initial setup
  const initialSetupDoneRef = useRef(false);

  // Update handleViewChange to show loading indicator
  const handleViewChange = useCallback(async (startTime: number, endTime: number, preservedLoopStart?: number, preservedLoopEnd?: number) => {
    // Clear any pending timeout
    if (viewChangeTimeoutRef.current) {
      clearTimeout(viewChangeTimeoutRef.current);
    }

    // Determine which loop region to restore
    // First check if user has manually set a loop region
    const userSetLoop = userSetLoopRef.current;
    // Then check if we have preserved values from the event
    const hasPreservedValues = preservedLoopStart !== undefined && preservedLoopEnd !== undefined;
    
    // Create a local copy of loop values to restore
    const loopRegionToRestore = userSetLoop ? 
      { start: userSetLoop.start, end: userSetLoop.end } : 
      hasPreservedValues ? 
        { start: preservedLoopStart!, end: preservedLoopEnd! } : 
        { start: loopStart, end: loopEnd };
    
    console.log('[App] View change requested with loop region:', {
      startTime,
      endTime,
      loopRegionToRestore,
      currentLoopStart: loopStart,
      currentLoopEnd: loopEnd,
      userSetLoop,
      isLoadingNewFile: isLoadingNewFileRef.current,
      stack: new Error().stack?.split('\n').slice(1, 3).join('\n')
    });

    // Only preserve loop region if we're not loading a new file
    // If we're loading a new file, let the file loading effect handle setting the loop region
    if (!isLoadingNewFileRef.current) {
      // Immediately preserve loop region
      const currentLoopStart = loopRegionToRestore.start;
      const currentLoopEnd = loopRegionToRestore.end;
      
      // Only update if values have changed
      if (Math.abs(loopStart - currentLoopStart) > 0.001 || Math.abs(loopEnd - currentLoopEnd) > 0.001) {
        setLoopStartWithLogging(currentLoopStart);
        setLoopEndWithLogging(currentLoopEnd);
      }
    } else {
      console.log('[App] Skipping loop region preservation in handleViewChange - loading new file');
    }

    // Set loading state
    setIsLoadingPitchData(true);

    // Set new timeout for data loading (separated from loop region handling)
    viewChangeTimeoutRef.current = setTimeout(async () => {
      try {
        // Only load segments if we're in progressive mode
        if (pitchManager.current.isInProgressiveMode()) {
          const duration = pitchManager.current.getTotalDuration();
          const isLongVideo = duration > 30;
          
          // Only consider it an initial load if we haven't done setup and have no data
          const isInitialLoad = !initialSetupDoneRef.current && nativePitchData.times.length === 0;
          
          console.log('[App] View change triggered:', { 
            startTime, 
            endTime,
            isInitialLoad,
            isLongVideo,
            duration,
            preservedLoopRegion: loopRegionToRestore,
            currentLoopStart: loopStart,
            currentLoopEnd: loopEnd,
            userSetLoop,
            isLoadingNewFile: isLoadingNewFileRef.current
          });
          
          // For initial load of long videos, force loading only first segment
          if (isInitialLoad && isLongVideo) {
            console.log('[App] Initial load of long video, forcing first segment only');
            await pitchManager.current.loadSegmentsForTimeRange(0, 10);
            const visibleData = pitchManager.current.getPitchDataForTimeRange(0, 10);
            
            // Set initial loop region for first load only if no user-set region
            // and we're not in the middle of loading a new file
            if (!userSetLoop && !isLoadingNewFileRef.current) {
              setLoopStartWithLogging(0);
              setLoopEndWithLogging(10);
            } else if (userSetLoop && !isLoadingNewFileRef.current) {
              // Restore user-set values
              setLoopStartWithLogging(userSetLoop.start);
              setLoopEndWithLogging(userSetLoop.end);
            }
            
            // Update pitch data
            setNativePitchData(visibleData);
            
            initialSetupDoneRef.current = true;
          } else if (!isInitialLoad) {
            // Only load new segments if this is not the initial setup
            await pitchManager.current.loadSegmentsForTimeRange(startTime, endTime);
            
            // Get data for the current view
            const visibleData = pitchManager.current.getPitchDataForTimeRange(startTime, endTime);
            
            // Update pitch data without modifying loop region
            setNativePitchData(visibleData);
            
            // Only check and restore loop region if we're not loading a new file
            if (!isLoadingNewFileRef.current) {
              // Ensure loop region is still correct after data loading
              // First check for userSetLoop, which takes highest priority
              if (userSetLoop) {
                if (loopStart !== userSetLoop.start || loopEnd !== userSetLoop.end) {
                  console.log('[App] Re-applying user-set loop region after data loading:', {
                    current: { start: loopStart, end: loopEnd },
                    userSet: userSetLoop
                  });
                  setLoopStartWithLogging(userSetLoop.start);
                  setLoopEndWithLogging(userSetLoop.end);
                }
              }
              // Then check for preserved values
              else if (Math.abs(loopStart - loopRegionToRestore.start) > 0.001 || 
                       Math.abs(loopEnd - loopRegionToRestore.end) > 0.001) {
                console.log('[App] Re-applying preserved loop region after data loading:', {
                  current: { start: loopStart, end: loopEnd },
                  preserved: loopRegionToRestore
                });
                setLoopStartWithLogging(loopRegionToRestore.start);
                setLoopEndWithLogging(loopRegionToRestore.end);
              }
            } else {
              console.log('[App] Skipping loop region restoration - loading new file');
            }
          }
        }
      } catch (error) {
        console.error('Error loading pitch data for time range:', error);
      } finally {
        // Clear loading state
        setIsLoadingPitchData(false);
      }
    }, 100); // 100ms debounce
  }, [nativePitchData.times, loopStart, loopEnd]);

  // Consolidate initial view setup into a single effect
  React.useEffect(() => {
    if (nativeChartInstance && nativePitchData.times.length > 0 && !initialSetupDoneRef.current) {
      const duration = nativePitchData.times[nativePitchData.times.length - 1];
      
      if (duration > 30) {
        const initialViewDuration = 10;
        console.log('[App] Setting initial view range for long video:', {
          duration,
          initialViewDuration,
          isInitialSetup: !initialSetupDoneRef.current
        });
        
        // Update zoom state ref directly
        if (nativeChartInstance.options.scales?.x) {
          nativeChartInstance.options.scales.x.min = 0;
          nativeChartInstance.options.scales.x.max = initialViewDuration;
          
          // Also update the zoom state ref in the PitchGraph component
          const chartWithZoomState = nativeChartInstance as unknown as { zoomStateRef: { current: { min: number; max: number } } };
          if (chartWithZoomState.zoomStateRef) {
            chartWithZoomState.zoomStateRef.current = { min: 0, max: initialViewDuration };
          }
          
          // Force the chart to update its layout
          nativeChartInstance.update('none');
          
          // Notify parent of view change
          handleViewChange(0, initialViewDuration);
          initialSetupDoneRef.current = true;
        }
      }
    }
  }, [nativeChartInstance, nativePitchData.times, handleViewChange]);

  // Modify onLoopChange to store the user-set values in the ref
  const onLoopChangeHandler = (start: number, end: number) => {
    console.log('[App] Loop region changed by user interaction:', { start, end });
    
    // Store these values as the last valid user-set values
    userSetLoopRef.current = { start, end };
    
    setLoopStartWithLogging(start);
    setLoopEndWithLogging(end);
    if (getActiveMediaElement()) {
      getActiveMediaElement()!.currentTime = start;
    }
    fitYAxisToLoop();
  };

  // Modify the fitYAxisToLoop function to check for valid user-set values
  function fitYAxisToLoop() {
    if (!nativePitchData.times.length) return;

    // Make sure we're using the last valid user-set loop region if available
    const currentLoopStart = loopStart;
    const currentLoopEnd = loopEnd;
    const userSetLoop = userSetLoopRef.current;

    // If we detect that the loop region doesn't match the user-set values, restore them
    if (userSetLoop && 
        (Math.abs(currentLoopStart - userSetLoop.start) > 0.001 || 
         Math.abs(currentLoopEnd - userSetLoop.end) > 0.001)) {
      console.log('[App] Loop region mismatch detected, restoring user-set values:', {
        current: { start: currentLoopStart, end: currentLoopEnd },
        userSet: userSetLoop
      });
      
      // Restore the user-set values
      setLoopStartWithLogging(userSetLoop.start);
      setLoopEndWithLogging(userSetLoop.end);
      
      // Use these values for further calculations
      return;
    }

    // Make sure we're using the latest loop region boundaries
    console.log('[App] Starting Y axis fitting with loop region:', {
      loopStart,
      loopEnd,
      stack: new Error().stack?.split('\n').slice(1, 3).join('\n')
    });

    // Find all pitches within the loop region
    const pitchesInRange = [];
    for (let i = 0; i < nativePitchData.times.length; i++) {
      const time = nativePitchData.times[i];
      if (time >= loopStart && time <= loopEnd) {
        const pitch = nativePitchData.pitches[i];
        if (pitch !== null) pitchesInRange.push(pitch);
      }
    }

    // Skip the rest of the fitting if we don't have any pitches in range
    if (pitchesInRange.length === 0) {
      console.log('[App] No pitches found in loop region, skipping Y axis fitting');
      return;
    }

    // Determine which pitches to use for y-axis fitting
    const pitchesToFit = pitchesInRange.length > 0 
      ? pitchesInRange 
      : nativePitchData.pitches.filter(p => p !== null) as number[];

    if (pitchesToFit.length === 0) return;

    // Calculate initial range
    let minPitch = Math.min(...pitchesToFit);
    let maxPitch = Math.max(...pitchesToFit);

    // Add padding (at least 20Hz or 10% of range)
    const padding = Math.max(20, (maxPitch - minPitch) * 0.1);
    minPitch = Math.floor(minPitch - padding);
    maxPitch = Math.ceil(maxPitch + padding);

    // Enforce absolute limits
    minPitch = Math.max(0, minPitch);
    maxPitch = Math.min(600, maxPitch);

    // Ensure minimum range for visibility
    if (maxPitch - minPitch < 200) {
      const center = (maxPitch + minPitch) / 2;
      const halfRange = 100;
      minPitch = Math.max(0, Math.floor(center - halfRange));
      maxPitch = Math.min(600, Math.ceil(center + halfRange));
    }

    // Cap maximum range
    if (maxPitch - minPitch > 600) {
      const center = (maxPitch + minPitch) / 2;
      const halfRange = 300;
      minPitch = Math.max(0, Math.floor(center - halfRange));
      maxPitch = Math.min(600, Math.ceil(center + halfRange));
    }

    console.log('[App] Fitting Y axis:', {
      source: pitchesInRange.length > 0 ? 'loop region' : 'all pitches',
      loopStart,
      loopEnd,
      pitchesFound: pitchesToFit.length,
      minPitch,
      maxPitch,
      range: maxPitch - minPitch
    });

    setLoopYFit([minPitch, maxPitch]);
  }

  // Update the view change handler
  const onViewChangeHandler = (startTime: number, endTime: number, preservedLoopStart?: number, preservedLoopEnd?: number) => {
    console.log('[App] View change from PitchGraph:', { 
      startTime, 
      endTime, 
      preservedLoopStart, 
      preservedLoopEnd,
      currentLoopStart: loopStart,
      currentLoopEnd: loopEnd,
      userSetLoop: userSetLoopRef.current
    });
    
    // Prefer user-set values if available, otherwise use preserved values
    const loopToPreserve = userSetLoopRef.current || 
      (preservedLoopStart !== undefined && preservedLoopEnd !== undefined ? 
        { start: preservedLoopStart, end: preservedLoopEnd } : 
        { start: loopStart, end: loopEnd });
        
    // Call handleViewChange with the preferred loop values
    handleViewChange(startTime, endTime, loopToPreserve.start, loopToPreserve.end);
  };

  // --- Native playback time tracking ---
  React.useEffect(() => {
    const media = getActiveMediaElement();
    if (!media) return;
    let raf: number | null = null;
    const update = () => {
      setNativePlaybackTime(media.currentTime || 0);
      raf = requestAnimationFrame(update);
    };
    if (!media.paused) {
      raf = requestAnimationFrame(update);
    }
    const onPlay = () => {
      raf = requestAnimationFrame(update);
    };
    const onPause = () => {
      if (raf) cancelAnimationFrame(raf);
    };
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [nativeMediaUrl, nativeMediaType]);

  // --- Native media loop segment logic ---
  React.useEffect(() => {
    const media = getActiveMediaElement();
    if (!media) return;
    let timeout: NodeJS.Timeout | null = null;
    if (
      !media.paused &&
      loopEnd > loopStart &&
      nativePlaybackTime >= loopEnd
    ) {
      media.pause();
      timeout = setTimeout(() => {
        media.currentTime = loopStart;
        media.play();
      }, loopDelay);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [nativePlaybackTime, loopStart, loopEnd, loopDelay]);

  // --- User recording playback time tracking ---
  React.useEffect(() => {
    const audio = userAudioRef.current;
    if (!audio) return;
    let raf: number | null = null;
    const update = () => {
      setUserPlaybackTime(audio.currentTime || 0);
      if (!audio.paused) {
        raf = requestAnimationFrame(update);
      }
    };
    const onPlay = () => {
      userAudioPlayingRef.current = true;
      raf = requestAnimationFrame(update);
    };
    const onPause = () => {
      userAudioPlayingRef.current = false;
      if (raf) cancelAnimationFrame(raf);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [userPitchData.times, audioBlob]);

  // On initial load or when nativePitchData changes, fit y axis to full pitch curve
  React.useEffect(() => {
    if (!nativePitchData.pitches.length) return;
    
    console.log('[App] nativePitchData.pitches changed, current loop region:', {
      loopStart,
      loopEnd
    });
    
    // We'll only adjust the Y-axis range but not change the loop region
    const pitches = nativePitchData.pitches.filter(p => p !== null) as number[];
    if (pitches.length > 0) {
      let minPitch = Math.min(...pitches);
      let maxPitch = Math.max(...pitches);
      minPitch = Math.floor(minPitch - 20);
      maxPitch = Math.ceil(maxPitch + 20);
      minPitch = Math.max(0, minPitch);
      maxPitch = Math.min(600, maxPitch);
      if (maxPitch - minPitch < 200) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 100));
        maxPitch = Math.min(600, Math.ceil(center + 100));
      }
      if (maxPitch - minPitch > 600) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 300));
        maxPitch = Math.min(600, Math.ceil(center + 300));
      }
      
      // Just update the Y-axis range, don't modify the loop region
      setLoopYFit([minPitch, maxPitch]);
    }
  }, [nativePitchData.pitches]);

  React.useEffect(() => {
    if (!audioBlob) {
      setUserAudioUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setUserAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);

  React.useEffect(() => {
    if (nativeChartInstance) {
      console.log('Chart ref is now set:', nativeChartInstance);
    }
  }, [nativeChartInstance]);

  // Get the active media element (either video or audio)
  const getActiveMediaElement = () => {
    if (nativeMediaType === 'video') return nativeVideoRef.current;
    if (nativeMediaType === 'audio') return nativeAudioRef.current;
    return null;
  };

  // Add handler for view changes (zooming/panning)
  const viewChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add state for media duration
  const [nativeMediaDuration, setNativeMediaDuration] = useState<number>(0);

  // Update duration when media is loaded
  React.useEffect(() => {
    const media = getActiveMediaElement();
    if (!media) return;
    
    const onLoadedMetadata = () => {
      // Use PitchDataManager's duration if available, otherwise fallback to media duration
      const duration = pitchManager.current.getTotalDuration() || media.duration;
      setNativeMediaDuration(duration);
      console.log('[App] Setting media duration:', {
        pitchManagerDuration: pitchManager.current.getTotalDuration(),
        mediaDuration: media.duration,
        finalDuration: duration
      });
    };
    
    media.addEventListener('loadedmetadata', onLoadedMetadata);
    // Set initial duration if already loaded
    if (media.duration) {
      const duration = pitchManager.current.getTotalDuration() || media.duration;
      setNativeMediaDuration(duration);
    }
    
    return () => {
      media.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [nativeMediaUrl, nativeMediaType]);

  // Add wrapped setState functions with logging
  const setLoopStartWithLogging = (value: number) => {
    console.log('[App] setLoopStart called with:', { 
      value, 
      previousValue: loopStart,
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
    setLoopStart(value);
  };
  
  const setLoopEndWithLogging = (value: number) => {
    console.log('[App] setLoopEnd called with:', { 
      value, 
      previousValue: loopEnd,
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n') 
    });
    setLoopEnd(value);
  };

  // Add a new useEffect to reset the loading flag after data is processed
  React.useEffect(() => {
    // If we had the loading flag set, and now we have pitch data
    if (isLoadingNewFileRef.current && nativePitchData.times.length > 0) {
      // Wait for the next render cycle to make sure other effects have run
      // This gives the useEffect that sets the loop region time to run
      const timerId = setTimeout(() => {
        console.log('[App] Resetting isLoadingNewFile flag after data loaded, delay complete');
        isLoadingNewFileRef.current = false;
      }, 100); // Give some time for other effects to process
      
      return () => clearTimeout(timerId);
    }
  }, [nativePitchData]);

  // Function to jump to current playback position
  const jumpToPlaybackPosition = () => {
    const media = getActiveMediaElement();
    if (!media || !nativeChartInstance) return;

    const currentTime = media.currentTime;
    const viewDuration = 10; // Show 10 seconds around current position
    
    // Calculate new view window centered around current time
    let startTime = Math.max(0, currentTime - viewDuration * 0.3); // Position current time at 30% of view
    let endTime = startTime + viewDuration;
    
    // If we're near the end of the video, adjust the window
    const totalDuration = pitchManager.current.getTotalDuration();
    if (endTime > totalDuration) {
      endTime = totalDuration;
      startTime = Math.max(0, endTime - viewDuration);
    }
    
    console.log('[App] Jumping to playback position:', {
      currentTime,
      newView: { startTime, endTime }
    });
    
    // First, set loading state to indicate we're changing view
    setIsLoadingPitchData(true);
    
    // Trigger data loading first
    handleViewChange(startTime, endTime);
    
    // Wait a short time for data to load before updating the chart view
    setTimeout(() => {
      // Update chart view after data is loaded
      if (nativeChartInstance && nativeChartInstance.setViewRange) {
        console.log('[App] Updating chart view range to:', { min: startTime, max: endTime });
        nativeChartInstance.setViewRange({ min: startTime, max: endTime });
      } else if (nativeChartInstance && nativeChartInstance.options.scales?.x) {
        // Fallback if setViewRange not available
        console.log('[App] Fallback: Updating chart scales directly');
        nativeChartInstance.options.scales.x.min = startTime;
        nativeChartInstance.options.scales.x.max = endTime;
        nativeChartInstance.update();
      }
      
      // Clear loading state
      setIsLoadingPitchData(false);
    }, 500); // Increased timeout to ensure data is loaded
  };

  return (
    <div 
      className="app-container"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        minHeight: '100vh',
      }}
    >
      {isDragging && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(25, 118, 210, 0.1)',
            border: '2px dashed #1976d2',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px 40px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              fontSize: '1.2em',
              color: '#1976d2',
            }}
          >
            Drop audio/video file here
          </div>
        </div>
      )}
      <div className="container">
        <h1 className="chorusing-title">Chorusing Drill</h1>
        <main style={{ flex: 1, padding: '1rem 0', width: '100%' }}>
          {/* Native Recording Section */}
          <section style={{ marginBottom: '1rem' }}>
            <input
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleNativeFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '8px 20px',
                borderRadius: 4,
                border: 'none',
                background: '#388e3c',
                color: '#fff',
                fontWeight: 500,
                cursor: 'pointer',
                marginBottom: '0.75rem',
                fontSize: '1rem'
              }}
            >
              Load Native Recording
            </button>
            {nativeMediaUrl && nativeMediaType === 'audio' && (
              <audio
                src={nativeMediaUrl}
                controls
                style={{
                  width: '100%',
                  marginBottom: '0.75rem',
                  maxWidth: '100%'
                }}
                ref={nativeAudioRef}
              />
            )}
            {nativeMediaUrl && nativeMediaType === 'video' && (
              <video
                ref={nativeVideoRef}
                src={nativeMediaUrl}
                controls
                playsInline
                loop
                style={{
                  width: '100%',
                  maxHeight: '180px',
                  marginBottom: '0.75rem',
                  maxWidth: '100%'
                }}
              />
            )}
            {/* Loop selection and delay controls (moved above the curve) */}
            {nativePitchData.times.length > 0 && (
              <div style={{ margin: '0.5rem 0 0.5rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', maxWidth: 400, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Loop region:</span>
                  <span style={{ fontSize: 12, flex: 1 }}>{loopStart.toFixed(2)}s - {loopEnd.toFixed(2)}s</span>
                  <button
                    onClick={() => {
                      const duration = nativePitchData.times.length > 0 ? nativePitchData.times[nativePitchData.times.length - 1] : 0;
                      userSetLoopRef.current = null;
                      console.log('[App] Clearing user-set loop region');
                      setLoopStartWithLogging(0);
                      setLoopEndWithLogging(duration);
                      const media = getActiveMediaElement();
                      if (media) {
                        media.currentTime = 0;
                      }
                    }}
                    title="Reset Loop Region"
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
                      marginLeft: 8,
                    }}
                  >
                    ↺
                  </button>
                </div>
                <div style={{ width: '100%', maxWidth: 400, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Loop delay (ms):</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={50}
                    value={loopDelay}
                    onChange={e => setLoopDelay(Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                  <button
                    style={{ fontSize: 12, padding: '2px 8px', marginLeft: 8 }}
                    title="Set loop to visible region"
                    disabled={!nativeChartInstance}
                    onClick={() => {
                      const chart = nativeChartInstance;
                      console.log('Loop visible button clicked. Chart ref:', chart);
                      if (chart && chart.scales && chart.scales.x) {
                        const xMin = chart.scales.x.min;
                        const xMax = chart.scales.x.max;
                        console.log('Setting loop to visible region:', xMin, xMax);
                        
                        // Update userSetLoopRef since this is a user action
                        userSetLoopRef.current = { start: xMin, end: xMax };
                        
                        setLoopStartWithLogging(xMin);
                        setLoopEndWithLogging(xMax);
                        const media = getActiveMediaElement();
                        if (media) {
                          media.currentTime = xMin;
                        }
                      } else {
                        console.log('Chart or x scale not available');
                      }
                    }}
                  >
                    Loop visible
                  </button>
                  
                  {/* Jump to playback position button - only for long videos */}
                  {nativeMediaDuration > 30 && (
                    <button
                      style={{ fontSize: 12, padding: '2px 8px', marginLeft: 8 }}
                      title="Jump to current playback position"
                      disabled={!nativeChartInstance || !getActiveMediaElement()}
                      onClick={jumpToPlaybackPosition}
                    >
                      Jump to playback
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            <div style={{ position: 'relative' }}>
              {isLoadingPitchData && (
                <div style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  zIndex: 10,
                  background: 'rgba(25, 118, 210, 0.2)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                  color: '#1976d2',
                  fontWeight: 'bold',
                  pointerEvents: 'none',
                }}>
                  Loading...
                </div>
              )}
              
              <PitchGraphWithControls
                onChartReady={setNativeChartInstance}
                times={nativePitchData.times}
                pitches={nativePitchData.pitches}
                label="Native Pitch (Hz)"
                color="#388e3c"
                loopStart={loopStart}
                loopEnd={loopEnd}
                yFit={loopYFit}
                playbackTime={nativePlaybackTime}
                onLoopChange={onLoopChangeHandler}
                onViewChange={onViewChangeHandler}
                showNavigationHints={true}
                totalDuration={nativeMediaDuration}
                initialViewDuration={nativeMediaDuration > 30 ? 10 : undefined}
              />
            </div>
          </section>

          {/* User Recording Section */}
          <section>
            <PitchGraphWithControls
              times={userPitchData.times}
              pitches={userPitchData.pitches}
              label="Your Pitch (Hz)"
              color="#1976d2"
              playbackTime={userPlaybackTime}
              showNavigationHints={false}
              totalDuration={userPitchData.times.length > 0 ? userPitchData.times[userPitchData.times.length - 1] : 0}
            />
            <Recorder
              onRecordingComplete={(_, blob: Blob) => setAudioBlob(blob)}
              audioUrl={userAudioUrl}
              audioRef={userAudioRef}
              showPlayer={true}
            />
          </section>
        </main>
        <Footer />
      </div>
      <style>{`
        .pitch-graph-container {
          touch-action: pinch-zoom pan-x pan-y;
        }
        @media (max-width: 768px) {
          .container {
            width: 100vw;
            overflow-x: hidden;
            box-sizing: border-box;
            padding-left: max(2vw, env(safe-area-inset-left));
            padding-right: max(2vw, env(safe-area-inset-right));
          }
          .pitch-graph-container {
            touch-action: none;
            height: 80px !important;
            min-height: 80px !important;
            max-height: 80px !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box;
            padding: 0;
            margin: 0;
          }
          .chorusing-title {
            font-size: 1.3rem;
            margin-bottom: 0.5rem;
          }
          .container, main, section, .pitch-graph-container, .chorusing-title {
            font-size: 0.95rem;
          }
          button, input, select {
            font-size: 0.95rem !important;
            padding: 4px 8px !important;
          }
        }
        body {
          overflow-x: hidden;
        }
      `}</style>
    </div>
  )
}

export default App
