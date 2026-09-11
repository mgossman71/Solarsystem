import { EarthScene } from './earth/EarthScene';

const app = document.getElementById('app');
if (!app) throw new Error('#app element not found');

const scene = new EarthScene(app);
scene.init();
