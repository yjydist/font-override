import { createScanner } from './scanner';
import { DEFAULTS, initializeSettings } from './settings';
import type { FontSettings } from './types';

const settings: FontSettings = { ...DEFAULTS };
const scanner = createScanner(settings);

initializeSettings(settings, scanner.requestFullScan);
scanner.start();
