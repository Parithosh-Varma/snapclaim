import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [scene, out, w = 1920, h = 1080] = process.argv.slice(2);
if (!scene || !out) { console.error('usage: node render.mjs scene.html out.mp4 [w h]'); process.exit(1); }

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto('file://' + path.resolve(scene));
await page.evaluate(() => document.fonts.ready);
const { duration, fps } = await page.evaluate(() => ({
  duration: window.SCENE.duration, fps: window.SCENE.fps || 30 }));
const n = Math.round(duration * fps);
const dir = `${out}.frames`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.SCENE.seek(t), i / fps);
  await page.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', `${dir}/%05d.png`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', `${out}.mp4`]);
console.log(`rendered ${out}.mp4 (${duration}s @ ${fps}fps, ${w}x${h})`);
