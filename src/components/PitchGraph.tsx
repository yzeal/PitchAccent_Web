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

const PitchGraph: React.FC<PitchGraphProps> = ({ audioBlob }) => {
  const [pitchData, setPitchData] = useState<{ times: number[]; pitches: number[] } | null>(null);
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
        const pitches: number[] = [];
        const times: number[] = [];
        for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
          const frame = channelData.slice(i, i + frameSize);
          const [pitch, clarity] = detector.findPitch(frame, sampleRate);
          pitches.push(pitch > 0 && clarity > 0.8 ? pitch : null);
          times.push(i / sampleRate);
        }
        setPitchData({ times, pitches });
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
      <div style={{ height: 200, background: '#eee', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 18 }}>
        Pitch graph will appear here
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ height: 200, background: '#eee', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 18 }}>
        Analyzing pitch...
      </div>
    );
  }

  if (!pitchData) {
    return (
      <div style={{ height: 200, background: '#eee', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f44336', fontSize: 18 }}>
        Could not extract pitch.
      </div>
    );
  }

  // Prepare data for Chart.js
  const chartData = {
    labels: pitchData.times,
    datasets: [
      {
        label: 'Pitch (Hz)',
        data: pitchData.pitches,
        borderColor: '#1976d2',
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
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
    <div style={{ height: 220, background: '#fff', borderRadius: 8, padding: 8 }}>
      <Line data={chartData} options={options} height={200} />
    </div>
  );
};

export default PitchGraph; 