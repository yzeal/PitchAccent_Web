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
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';

ChartJS.register(LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, zoomPlugin);

export interface PitchGraphWithControlsProps {
  times: number[];
  pitches: (number | null)[];
  label?: string;
  color?: string;
  initialYRange?: [number, number];
  yMinLimit?: number;
  yMaxLimit?: number;
  yRangeMin?: number;
  yRangeMax?: number;
}

const DEFAULT_Y_MIN_LIMIT = 0;
const DEFAULT_Y_MAX_LIMIT = 600;
const DEFAULT_Y_RANGE_MIN = 200;
const DEFAULT_Y_RANGE_MAX = 600;

const PitchGraphWithControls: React.FC<PitchGraphWithControlsProps> = ({
  times,
  pitches,
  label = 'Pitch (Hz)',
  color = '#1976d2',
  initialYRange,
  yMinLimit = DEFAULT_Y_MIN_LIMIT,
  yMaxLimit = DEFAULT_Y_MAX_LIMIT,
  yRangeMin = DEFAULT_Y_RANGE_MIN,
  yRangeMax = DEFAULT_Y_RANGE_MAX,
}) => {
  const chartRef = useRef<any>(null);
  // y-axis range state
  const [yRange, setYRange] = useState<[number, number]>(
    initialYRange || [yRangeMin, yRangeMax]
  );

  useEffect(() => {
    // If times or pitches change, auto-range to min/max of curve + 50 Hz padding
    const validPitches = pitches.filter((p) => p !== null) as number[];
    if (validPitches.length > 0) {
      const minPitch = Math.min(...validPitches);
      const maxPitch = Math.max(...validPitches);
      const paddedMin = Math.max(yMinLimit, Math.floor(minPitch - 50));
      const paddedMax = Math.min(yMaxLimit, Math.ceil(maxPitch + 50));
      setYRange([paddedMin, paddedMax]);
    } else {
      setYRange([yRangeMin, yRangeMax]);
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
          y: { min: yMinLimit, max: yMaxLimit },
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
    value = Math.max(yMinLimit, Math.min(yMaxLimit, value));
    const newRange: [number, number] = [...yRange] as [number, number];
    newRange[index] = value;
    // Ensure min <= max
    if (newRange[0] > newRange[1]) {
      if (index === 0) newRange[1] = value;
      else newRange[0] = value;
    }
    setYRange([Math.min(...newRange), Math.max(...newRange)]);
  };

  return (
    <div style={{ width: '100%', background: '#fff', borderRadius: 8, padding: 8, marginBottom: 24 }}>
      <div style={{ height: 320 }}>
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
          inputProps={{ min: yMinLimit, max: yRange[1], step: 1, style: { width: 60 } }}
        />
        <Slider
          value={yRange}
          onChange={handleSliderChange}
          min={yMinLimit}
          max={yMaxLimit}
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
          inputProps={{ min: yRange[0], max: yMaxLimit, step: 1, style: { width: 60 } }}
        />
        <div style={{ flex: 1 }} />
        <button onClick={handleResetZoom} style={{ padding: '6px 16px', borderRadius: 4, border: 'none', background: '#1976d2', color: '#fff', cursor: 'pointer' }}>
          Reset Zoom
        </button>
      </div>
    </div>
  );
};

export default PitchGraphWithControls; 