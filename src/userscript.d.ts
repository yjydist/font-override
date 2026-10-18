export type ValueChangeListener = (
  key: string,
  oldValue: unknown,
  newValue: unknown,
  remote: boolean,
) => void;

declare global {
  function GM_getValue(key: string, fallback?: unknown): unknown;
  function GM_setValue(key: string, value: unknown): void;
  function GM_registerMenuCommand(label: string, callback: () => void): string | number;
  function GM_addValueChangeListener(key: string, callback: ValueChangeListener): number;
}
