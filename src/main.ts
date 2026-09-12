import { EarthScene } from './earth/EarthScene';

const app = document.getElementById('app');
if (!app) throw new Error('#app element not found');

const scene = new EarthScene(app);
scene.init();

// Debug/test hook (used by the CDP test driver; harmless in production).
(window as unknown as Record<string, unknown>).__earth = scene;
