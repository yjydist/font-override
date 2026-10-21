export {};

declare global {
  interface Window {
    __metrics: { measurements: number; writes: number; boundaryMeasurements: number; boundaryWrites: number; pseudoReads: number };
    __samples?: [number, string | null, number | null][];
    __paints?: [string, number][];
    __slowRan?: number;
    __parseTime?: [number, string];
    __originalGetComputedStyle?: typeof getComputedStyle;
    __frameSamples?: [number, string | null][];
    __frameSamplesPaints?: [string, number][];
    __ruleAppliedAt?: number;
    __placeholder?: FontFace;
    __icon?: FontFace;
  }
}
