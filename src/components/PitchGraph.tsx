import React, { useEffect, useState, useRef } from 'react';
import { PitchDetector } from 'pitchy';
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
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, zoomPlugin);

interface PitchGraphProps {
  audioBlob: Blob | null;
}

// Simple median filter for smoothing
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

const MIN_PITCH = 60;
const MAX_PITCH = 500;
const MIN_CLARITY = 0.8;
const MEDIAN_FILTER_SIZE = 5;

const Y_MIN_LIMIT = 0;
const Y_MAX_LIMIT = 600;
const Y_RANGE_MIN = 200;
const Y_RANGE_MAX = 600;

const PitchGraph: React.FC<PitchGraphProps> = ({ audioBlob }) => {
  const [pitchData, setPitchData] = useState<{ times: number[]; pitches: (number | null)[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const lastBlob = useRef<Blob | null>(null);
  const chartRef = useRef<any>(null);
  // y-axis range state
  const [yRange, setYRange] = useState<[number, number]>([Y_RANGE_MIN, Y_RANGE_MAX]);

  useEffect(() => {
    if (!audioBlob || audioBlob === lastBlob.current) return;
    setLoading(true);
    setPitchData(null);
    lastBlob.current = audioBlob;

    const processAudio = async () => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const sampleRate = audioBuffer.sampleRate;
        const frameSize = 2048;
        const hopSize = 256;
        const detector = PitchDetector.forFloat32Array(frameSize);
        const pitches: (number | null)[] = [];
        const times: number[] = [];
        for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
          const frame = channelData.slice(i, i + frameSize);
          const [pitch, clarity] = detector.findPitch(frame, sampleRate);
          // Filter: only keep pitches in range and with high clarity
          if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && clarity >= MIN_CLARITY) {
            pitches.push(pitch);
          } else {
            pitches.push(null);
          }
          times.push(i / sampleRate);
        }
        // Apply median filter for smoothing
        const smoothed = medianFilter(pitches, MEDIAN_FILTER_SIZE);
        setPitchData({ times, pitches: smoothed });
        // Set y-axis range to min/max of pitch curve + 50 Hz padding
        const validPitches = smoothed.filter((p) => p !== null) as number[];
        if (validPitches.length > 0) {
          const minPitch = Math.min(...validPitches);
          const maxPitch = Math.max(...validPitches);
          const paddedMin = Math.max(Y_MIN_LIMIT, Math.floor(minPitch - 50));
          const paddedMax = Math.min(Y_MAX_LIMIT, Math.ceil(maxPitch + 50));
          setYRange([paddedMin, paddedMax]);
        } else {
          setYRange([Y_RANGE_MIN, Y_RANGE_MAX]);
        }
      } catch (e) {
        setPitchData(null);
        setYRange([Y_RANGE_MIN, Y_RANGE_MAX]);
      } finally {
        setLoading(false);
      }
    };
    processAudio();
  }, [audioBlob]);

  if (!audioBlob) {
    return (
      <div style={{ width: '100%', height: 380, background: '#eee', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 18 }}>
        Pitch graph will appear here
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ width: '100%', height: 380, background: '#eee', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 18 }}>
        Analyzing pitch...
      </div>
    );
  }

  if (!pitchData) {
    return (
      <div style={{ width: '100%', height: 380, background: '#eee', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f44336', fontSize: 18 }}>
        Could not extract pitch.
      </div>
    );
  }

  // Prepare data for Chart.js
  const lastTime = pitchData.times.length > 0 ? pitchData.times[pitchData.times.length - 1] : 5;
  const xMax = Math.max(2, lastTime);
  const chartData = {
    labels: pitchData.times,
    datasets: [
      {
        label: 'Pitch (Hz)',
        data: pitchData.pitches,
        borderColor: '#1976d2',
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        // spanGaps: false ensures the curve breaks at nulls (unvoiced/silence/spikes)
        spanGaps: false,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
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
          modifierKey: null,
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true, speed: 0.01 },
          mode: 'x' as const,
        },
        limits: {
          x: { min: 0, max: xMax },
          y: { min: Y_MIN_LIMIT, max: Y_MAX_LIMIT },
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: { display: true, text: 'Time (s)' },
        ticks: { maxTicksLimit: 8 },
        min: 0,
        max: xMax,
      },
      y: {
        title: { display: true, text: 'Pitch (Hz)' },
        min: yRange[0],
        max: yRange[1],
      },
    },
    elements: {
      line: { tension: 0.2 },
    },
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // Slider/input handlers
  const handleSliderChange = (_: any, newValue: number | number[]) => {
    if (Array.isArray(newValue)) {
      setYRange([Math.min(...newValue), Math.max(...newValue)]);
    }
  };
  const handleInputChange = (index: 0 | 1) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = Number(e.target.value);
    if (isNaN(value)) value = yRange[index];
    value = Math.max(Y_MIN_LIMIT, Math.min(Y_MAX_LIMIT, value));
    let newRange: [number, number] = [...yRange] as [number, number];
    newRange[index] = value;
    // Ensure min <= max
    if (newRange[0] > newRange[1]) {
      if (index === 0) newRange[1] = value;
      else newRange[0] = value;
    }
    setYRange([Math.min(...newRange), Math.max(...newRange)]);
  };

  return (
    <div style={{ width: '100%', background: '#fff', borderRadius: 8, padding: 8 }}>
      <div style={{ height: 380 }}>
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>Pitch range (Hz):</span>
        <TextField
          size="small"
          type="number"
          label="Min"
          value={yRange[0]}
          onChange={handleInputChange(0)}
          inputProps={{ min: Y_MIN_LIMIT, max: yRange[1], step: 1, style: { width: 60 } }}
        />
        <Slider
          value={yRange}
          onChange={handleSliderChange}
          min={Y_MIN_LIMIT}
          max={Y_MAX_LIMIT}
          step={1}
          valueLabelDisplay="auto"
          sx={{ width: 220 }}
        />
        <TextField
          size="small"
          type="number"
          label="Max"
          value={yRange[1]}
          onChange={handleInputChange(1)}
          inputProps={{ min: yRange[0], max: Y_MAX_LIMIT, step: 1, style: { width: 60 } }}
        />
        <div style={{ flex: 1 }} />
        <button onClick={handleResetZoom} style={{ padding: '6px 16px', borderRadius: 4, border: 'none', background: '#1976d2', color: '#fff', cursor: 'pointer' }}>
          Reset Zoom
        </button>
      </div>
    </div>
  );
};

export default PitchGraph; 