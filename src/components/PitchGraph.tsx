import React, { useEffect, useState, useRef } from 'react';
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

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, zoomPlugin);

export interface PitchGraphWithControlsProps {
  times: number[];
  pitches: (number | null)[];
  label?: string;
  color?: string;
}

const MIN_VISIBLE_RANGE = 200;
const MAX_VISIBLE_RANGE = 600;
const Y_MIN_LIMIT = 0;
const Y_MAX_LIMIT = 600;

const PitchGraphWithControls: React.FC<PitchGraphWithControlsProps> = ({
  times,
  pitches,
  label = 'Pitch (Hz)',
  color = '#1976d2',
}) => {
  const chartRef = useRef<any>(null);
  const [yRange, setYRange] = useState<[number, number]>([Y_MIN_LIMIT, Y_MAX_LIMIT]);

  useEffect(() => {
    // Auto-range to min/max of curve, but clamp to at least 200 Hz and at most 600 Hz
    const validPitches = pitches.filter((p) => p !== null) as number[];
    if (validPitches.length > 0) {
      let minPitch = Math.min(...validPitches);
      let maxPitch = Math.max(...validPitches);
      // Add padding
      minPitch = Math.floor(minPitch - 20);
      maxPitch = Math.ceil(maxPitch + 20);
      // Clamp to limits
      minPitch = Math.max(Y_MIN_LIMIT, minPitch);
      maxPitch = Math.min(Y_MAX_LIMIT, maxPitch);
      // Ensure at least MIN_VISIBLE_RANGE is visible
      if (maxPitch - minPitch < MIN_VISIBLE_RANGE) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(Y_MIN_LIMIT, Math.floor(center - MIN_VISIBLE_RANGE / 2));
        maxPitch = Math.min(Y_MAX_LIMIT, Math.ceil(center + MIN_VISIBLE_RANGE / 2));
      }
      // Ensure at most MAX_VISIBLE_RANGE is visible
      if (maxPitch - minPitch > MAX_VISIBLE_RANGE) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(Y_MIN_LIMIT, Math.floor(center - MAX_VISIBLE_RANGE / 2));
        maxPitch = Math.min(Y_MAX_LIMIT, Math.ceil(center + MAX_VISIBLE_RANGE / 2));
      }
      setYRange([minPitch, maxPitch]);
    } else {
      setYRange([Y_MIN_LIMIT, Y_MIN_LIMIT + MIN_VISIBLE_RANGE]);
    }
    // eslint-disable-next-line
  }, [times, pitches]);

  const lastTime = times.length > 0 ? times[times.length - 1] : 5;
  const xMax = Math.max(2, lastTime);
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
        <Line ref={chartRef} data={chartData} options={options} />
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