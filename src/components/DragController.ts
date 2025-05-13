import { Chart } from 'chart.js';

export type Edge = 'start' | 'end' | null;

interface DragState {
  isDragging: boolean;
  edge: Edge;
  initialX: number | null;
  currentValue: number | null;
  visualStart: number;
  visualEnd: number;
  isDragFromMargin: boolean;
}

export class DragController {
  private dragState: DragState = {
    isDragging: false,
    edge: null,
    initialX: null,
    currentValue: null,
    visualStart: 0,
    visualEnd: 0,
    isDragFromMargin: false
  };

  private chart: Chart | null = null;
  private onLoopChange: ((start: number, end: number) => void) | null = null;
  private loopStart: number = 0;
  private loopEnd: number = 0;
  private edgeThresholdPixels: number = 20;
  private marginThresholdPixels: number = 40;

  constructor(options: {
    chart: Chart | null;
    onLoopChange: ((start: number, end: number) => void) | null;
    loopStart: number;
    loopEnd: number;
    edgeThresholdPixels?: number;
    marginThresholdPixels?: number;
  }) {
    this.chart = options.chart;
    this.onLoopChange = options.onLoopChange;
    this.loopStart = options.loopStart;
    this.loopEnd = options.loopEnd;
    if (options.edgeThresholdPixels !== undefined) {
      this.edgeThresholdPixels = options.edgeThresholdPixels;
    }
    if (options.marginThresholdPixels !== undefined) {
      this.marginThresholdPixels = options.marginThresholdPixels;
    }
    this.dragState.visualStart = this.loopStart;
    this.dragState.visualEnd = this.loopEnd;
  }

  public updateValues(values: {
    chart?: Chart | null;
    onLoopChange?: ((start: number, end: number) => void) | null;
    loopStart?: number;
    loopEnd?: number;
  }) {
    if (values.chart !== undefined) this.chart = values.chart;
    if (values.onLoopChange !== undefined) this.onLoopChange = values.onLoopChange;
    if (values.loopStart !== undefined && !this.dragState.isDragging) {
      this.loopStart = values.loopStart;
      this.dragState.visualStart = values.loopStart;
    }
    if (values.loopEnd !== undefined && !this.dragState.isDragging) {
      this.loopEnd = values.loopEnd;
      this.dragState.visualEnd = values.loopEnd;
    }
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

  public getVisualValues(): { start: number; end: number } {
    return {
      start: this.dragState.visualStart,
      end: this.dragState.visualEnd
    };
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

  private getCanvasCoordinates(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if (!this.chart?.canvas) return null;

    const canvas = this.chart.canvas;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    // Get the relative position within the canvas
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  private getNearestEdge(x: number): Edge {
    if (!this.chart?.scales?.x) return null;

    const pixelsPerUnit = this.chart.scales.x.width / (this.chart.scales.x.max - this.chart.scales.x.min);
    const threshold = this.edgeThresholdPixels / pixelsPerUnit;

    const distanceToStart = Math.abs(x - this.dragState.visualStart);
    const distanceToEnd = Math.abs(x - this.dragState.visualEnd);

    if (distanceToStart <= threshold && distanceToStart <= distanceToEnd) return 'start';
    if (distanceToEnd <= threshold) return 'end';
    return null;
  }

  private isInMarginArea(canvasX: number): Edge | null {
    if (!this.chart?.scales?.x) return null;
    
    const chartArea = this.chart.chartArea;
    
    if (canvasX < chartArea.left && canvasX >= chartArea.left - this.marginThresholdPixels) {
      return 'start';
    }
    
    if (canvasX > chartArea.right && canvasX <= chartArea.right + this.marginThresholdPixels) {
      return 'end';
    }
    
    return null;
  }

  public handleMouseDown = (event: MouseEvent | TouchEvent): boolean => {
    const coords = this.getChartCoordinates(event);
    const canvasCoords = this.getCanvasCoordinates(event);
    
    if (!coords || !canvasCoords) return false;

    const edge = this.getNearestEdge(coords.x);
    
    const marginEdge = edge ? null : this.isInMarginArea(canvasCoords.x);
    
    if (!edge && !marginEdge) return false;

    event.preventDefault();
    event.stopPropagation();

    const selectedEdge = edge || marginEdge;
    const isDragFromMargin = !!marginEdge;
    
    let initialValue;
    if (isDragFromMargin) {
      if (selectedEdge === 'start') {
        initialValue = this.chart?.scales?.x?.min ?? 0;
        this.dragState.visualStart = initialValue;
      } else {
        initialValue = this.chart?.scales?.x?.max ?? 5;
        this.dragState.visualEnd = initialValue;
      }
    } else {
      initialValue = selectedEdge === 'start' ? this.dragState.visualStart : this.dragState.visualEnd;
    }

    // Disable panning in zoom plugin
    if (this.chart?.options?.plugins?.zoom?.pan) {
      this.chart.options.plugins.zoom.pan.enabled = false;
    }

    this.dragState = {
      isDragging: true,
      edge: selectedEdge,
      initialX: coords.x,
      currentValue: initialValue,
      visualStart: this.dragState.visualStart,
      visualEnd: this.dragState.visualEnd,
      isDragFromMargin
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

    this.dragState.currentValue = newX;
    if (this.dragState.edge === 'start' && newX < this.dragState.visualEnd) {
      this.dragState.visualStart = newX;
    } else if (this.dragState.edge === 'end' && newX > this.dragState.visualStart) {
      this.dragState.visualEnd = newX;
    }

    this.chart.options.plugins.loopOverlay = {
      loopStart: this.dragState.visualStart,
      loopEnd: this.dragState.visualEnd
    };

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
      const newStart = this.dragState.edge === 'start' ? this.dragState.visualStart : this.loopStart;
      const newEnd = this.dragState.edge === 'end' ? this.dragState.visualEnd : this.loopEnd;

      if (newStart !== this.loopStart || newEnd !== this.loopEnd) {
        this.onLoopChange(newStart, newEnd);
      }
    }

    // Re-enable panning in zoom plugin
    if (this.chart?.options?.plugins?.zoom?.pan) {
      this.chart.options.plugins.zoom.pan.enabled = true;
    }

    const { visualStart, visualEnd } = this.dragState;
    this.dragState = {
      isDragging: false,
      edge: null,
      initialX: null,
      currentValue: null,
      visualStart,
      visualEnd,
      isDragFromMargin: false
    };
  };
} 