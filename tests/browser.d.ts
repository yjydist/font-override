export {};

declare global {
  interface Window {
    __menus: Record<string, () => void>;
    __writes: { key: string; value: unknown }[];
    __metrics: { observers: number; tasks: number; measurements: number; writes: number };
    __deliverSetting(key: string, value: unknown, remote: boolean): void;
    __persistFontSetting?: (key: string, value: unknown) => Promise<void>;
  }
}
