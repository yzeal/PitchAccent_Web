// Global type declarations

// Define custom extensions to the Window interface
interface Window {
  eruda?: {
    init: (options?: {
      tool?: string[];
      useShadowDom?: boolean;
      autoScale?: boolean;
      defaults?: {
        displaySize?: number;
        transparency?: number;
        theme?: string;
      };
    }) => void;
    get: (name: string) => unknown;
    $: (selector: string) => HTMLElement | null;
  };
  exportLogs?: () => void;
  webkitAudioContext: typeof AudioContext;
} 