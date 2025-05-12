import React, { useEffect, useState } from 'react';
import { useRef } from 'react';
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

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale);

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

const PitchGraph: React.FC<PitchGraphProps> = ({ audioBlob }) => {
  const [pitchData, setPitchData] = useState<{ times: number[]; pitches: (number | null)[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const lastBlob = useRef<Blob | null>(null);

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
      } catch (e) {
        setPitchData(null);
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
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { enabled: true },
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
        min: 0,
        max: 600,
      },
    },
    elements: {
      line: { tension: 0.2 },
    },
  };

  return (
    <div style={{ width: '100%', height: 380, background: '#fff', borderRadius: 8, padding: 8 }}>
      <Line data={chartData} options={options} />
    </div>
  );
};

export default PitchGraph; 