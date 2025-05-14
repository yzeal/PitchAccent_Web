import { PitchDetector } from 'pitchy';

export interface ProgressiveLoadingConfig {
  // If file duration is below this, load everything at once
  thresholdDuration: number;  // e.g., 30 seconds
  
  // Size of segments when loading progressively
  segmentDuration: number;    // e.g., 10 seconds
  
  // How many segments to load ahead of current view
  preloadSegments: number;    // e.g., 1 segment ahead
  
  // Keep this many segments in memory
  maxCachedSegments: number;  // e.g., 6 segments
}

export interface PitchSegment {
  startTime: number;
  endTime: number;
  times: number[];
  pitches: (number | null)[];
  isProcessed: boolean;
}

export interface PitchData {
  times: number[];
  pitches: (number | null)[];
}

const MIN_PITCH = 60;
const MAX_PITCH = 500;
const MIN_CLARITY = 0.8;
const MEDIAN_FILTER_SIZE = 5;

// Median filter for smoothing
function medianFilter(arr: (number | null)[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    const window: number[] = [];
    for (let j = Math.max(0, i - Math.floor(windowSize / 2)); j <= Math.min(arr.length - 1, i + Math.floor(windowSize / 2)); j++) {
      if (arr[j] !== null && !isNaN(arr[j]!)) window.push(arr[j]!);
    }
    if (window.length > 0) {
      window.sort((a, b) => a - b);
      result.push(window[Math.floor(window.length / 2)]);
    } else {
      result.push(null);
    }
  }
  return result;
}

export class PitchDataManager {
  private segments: Map<number, PitchSegment> = new Map();
  private config: ProgressiveLoadingConfig;
  private totalDuration: number = 0;
  private isProgressiveMode: boolean = false;
  private audioContext: AudioContext;
  private currentFile: File | null = null;

  constructor(config: ProgressiveLoadingConfig) {
    this.config = config;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  private async getFileDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not load audio file'));
      });
    });
  }

  async initialize(file: File) {
    this.currentFile = file;
    this.totalDuration = await this.getFileDuration(file);
    this.isProgressiveMode = this.totalDuration > this.config.thresholdDuration;

    if (!this.isProgressiveMode) {
      // Process entire file at once
      const fullPitchData = await this.processEntireFile(file);
      this.segments.set(0, {
        startTime: 0,
        endTime: this.totalDuration,
        times: fullPitchData.times,
        pitches: fullPitchData.pitches,
        isProcessed: true
      });
    } else {
      // Just initialize segment map
      this.initializeSegments();
    }
  }

  private async processEntireFile(file: File): Promise<PitchData> {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
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
    return { times, pitches: smoothed };
  }

  private initializeSegments() {
    const numSegments = Math.ceil(this.totalDuration / this.config.segmentDuration);
    for (let i = 0; i < numSegments; i++) {
      const startTime = i * this.config.segmentDuration;
      this.segments.set(i, {
        startTime,
        endTime: Math.min(startTime + this.config.segmentDuration, this.totalDuration),
        times: [],
        pitches: [],
        isProcessed: false
      });
    }
  }

  async loadSegmentsForTimeRange(startTime: number, endTime: number) {
    if (!this.isProgressiveMode) return;

    const startSegment = Math.floor(startTime / this.config.segmentDuration);
    const endSegment = Math.floor(endTime / this.config.segmentDuration);
    
    // Load visible segments plus preload
    for (let i = startSegment; i <= endSegment + this.config.preloadSegments; i++) {
      if (this.segments.has(i) && !this.segments.get(i)!.isProcessed) {
        await this.processSegment(i);
      }
    }

    // Cleanup old segments if needed
    this.cleanupOldSegments(startSegment);
  }

  private async processSegment(segmentIndex: number) {
    const segment = this.segments.get(segmentIndex);
    if (!segment || segment.isProcessed) return;

    const file = this.currentFile;
    if (!file) throw new Error('No file loaded');

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Calculate sample indices for this segment
    const startSample = Math.floor(segment.startTime * sampleRate);
    const endSample = Math.floor(segment.endTime * sampleRate);
    
    const frameSize = 2048;
    const hopSize = 256;
    const detector = PitchDetector.forFloat32Array(frameSize);
    const pitches: (number | null)[] = [];
    const times: number[] = [];

    // Only process samples within this segment
    for (let i = startSample; i + frameSize < endSample; i += hopSize) {
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
    
    // Update the segment with processed data
    this.segments.set(segmentIndex, {
      ...segment,
      times,
      pitches: smoothed,
      isProcessed: true
    });
  }

  private cleanupOldSegments(currentSegment: number) {
    const segmentsToKeep = new Set(
      Array.from({ length: this.config.maxCachedSegments }, 
        (_, i) => currentSegment + i - Math.floor(this.config.maxCachedSegments / 2)
      )
    );

    for (const [index, segment] of this.segments.entries()) {
      if (!segmentsToKeep.has(index) && segment.isProcessed) {
        // Keep segment metadata but clear processed data
        this.segments.set(index, {
          ...segment,
          times: [],
          pitches: [],
          isProcessed: false
        });
      }
    }
  }

  getPitchDataForTimeRange(startTime: number, endTime: number): PitchData {
    let times: number[] = [];
    let pitches: (number | null)[] = [];

    for (const segment of this.segments.values()) {
      if (segment.isProcessed && 
          segment.endTime >= startTime && 
          segment.startTime <= endTime) {
        const startIdx = segment.times.findIndex(t => t >= startTime);
        const endIdx = segment.times.findIndex(t => t > endTime);
        times = times.concat(segment.times.slice(startIdx, endIdx));
        pitches = pitches.concat(segment.pitches.slice(startIdx, endIdx));
      }
    }

    return { times, pitches };
  }

  // Add method to check if we're in progressive mode
  isInProgressiveMode(): boolean {
    return this.isProgressiveMode;
  }
} 