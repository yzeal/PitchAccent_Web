import { Chart } from 'chart.js';

export type Edge = 'start' | 'end' | null;

interface DragState {
  isDragging: boolean;
  edge: Edge;
  initialX: number | null;
  currentValue: number | null;
}

export class DragController {
  private dragState: DragState = {
    isDragging: false,
    edge: null,
    initialX: null,
    currentValue: null
  };

  private chart: Chart | null = null;
  private onLoopChange: ((start: number, end: number) => void) | null = null;
  private loopStart: number = 0;
  private loopEnd: number = 0;
  private edgeThresholdPixels: number = 20;

  constructor(options: {
    chart: Chart | null;
    onLoopChange: ((start: number, end: number) => void) | null;
    loopStart: number;
    loopEnd: number;
    edgeThresholdPixels?: number;
  }) {
    this.chart = options.chart;
    this.onLoopChange = options.onLoopChange;
    this.loopStart = options.loopStart;
    this.loopEnd = options.loopEnd;
    if (options.edgeThresholdPixels !== undefined) {
      this.edgeThresholdPixels = options.edgeThresholdPixels;
    }
  }

  public updateValues(values: {
    chart?: Chart | null;
    onLoopChange?: ((start: number, end: number) => void) | null;
    loopStart?: number;
    loopEnd?: number;
  }) {
    if (values.chart !== undefined) this.chart = values.chart;
    if (values.onLoopChange !== undefined) this.onLoopChange = values.onLoopChange;
    if (values.loopStart !== undefined) this.loopStart = values.loopStart;
    if (values.loopEnd !== undefined) this.loopEnd = values.loopEnd;
  }

  public isDragging(): boolean {
    return this.dragState.isDragging;
  }

  public getCurrentEdge(): Edge {
    return this.dragState.edge;
  }

  public getCurrentValue(): number | null {
    return this.dragState.currentValue;
  }

  private getChartCoordinates(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if (!this.chart?.canvas) return null;

    const canvas = this.chart.canvas;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    // Get the relative position within the canvas
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Convert to chart values using Chart.js's built-in methods
    return {
      x: this.chart.scales.x.getValueForPixel(x) ?? 0,
      y: this.chart.scales.y.getValueForPixel(y) ?? 0
    };
  }

  private getNearestEdge(x: number): Edge {
    if (!this.chart?.scales?.x) return null;

    const pixelsPerUnit = this.chart.scales.x.width / (this.chart.scales.x.max - this.chart.scales.x.min);
    const threshold = this.edgeThresholdPixels / pixelsPerUnit;

    const distanceToStart = Math.abs(x - this.loopStart);
    const distanceToEnd = Math.abs(x - this.loopEnd);

    if (distanceToStart <= threshold && distanceToStart <= distanceToEnd) return 'start';
    if (distanceToEnd <= threshold) return 'end';
    return null;
  }

  public handleMouseDown = (event: MouseEvent | TouchEvent): boolean => {
    const coords = this.getChartCoordinates(event);
    if (!coords) return false;

    const edge = this.getNearestEdge(coords.x);
    if (!edge) return false;

    event.preventDefault();
    event.stopPropagation();

    this.dragState = {
      isDragging: true,
      edge,
      initialX: coords.x,
      currentValue: edge === 'start' ? this.loopStart : this.loopEnd
    };

    return true;
  };

  public handleMouseMove = (event: MouseEvent | TouchEvent): void => {
    if (!this.dragState.isDragging || !this.chart?.options?.plugins) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = this.getChartCoordinates(event);
    if (!coords) return;

    const minX = this.chart.scales.x.min ?? 0;
    const maxX = this.chart.scales.x.max ?? 5;
    const newX = Math.max(minX, Math.min(maxX, coords.x));

    // Update the current value
    this.dragState.currentValue = newX;

    // Update the chart's overlay immediately for visual feedback
    if (this.dragState.edge === 'start' && newX < this.loopEnd) {
      this.chart.options.plugins.loopOverlay = {
        loopStart: newX,
        loopEnd: this.loopEnd
      };
    } else if (this.dragState.edge === 'end' && newX > this.loopStart) {
      this.chart.options.plugins.loopOverlay = {
        loopStart: this.loopStart,
        loopEnd: newX
      };
    }

    // Request a redraw
    requestAnimationFrame(() => {
      if (!this.chart?.ctx) return;
      this.chart.draw();
    });
  };

  public handleMouseUp = (event: MouseEvent | TouchEvent): void => {
    if (!this.dragState.isDragging) return;

    event.preventDefault();
    event.stopPropagation();

    if (this.dragState.currentValue !== null && this.onLoopChange) {
      const newStart = this.dragState.edge === 'start' ? this.dragState.currentValue : this.loopStart;
      const newEnd = this.dragState.edge === 'end' ? this.dragState.currentValue : this.loopEnd;

      // Only call onLoopChange if values actually changed
      if (newStart !== this.loopStart || newEnd !== this.loopEnd) {
        this.onLoopChange(newStart, newEnd);
      }
    }

    // Reset drag state
    this.dragState = {
      isDragging: false,
      edge: null,
      initialX: null,
      currentValue: null
    };
  };
} 