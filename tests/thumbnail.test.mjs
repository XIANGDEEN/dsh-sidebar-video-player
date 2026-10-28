import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const regionStart = clientSource.indexOf('// #region video-thumbnail');
const regionEnd = clientSource.indexOf('// #endregion', regionStart);
assert.ok(regionStart >= 0 && regionEnd > regionStart, 'thumbnail region markers must exist');
const thumbnailSource = clientSource.slice(regionStart, regionEnd) + '\nexport { captureVideoThumbnail };\n';
const thumbnailModule = await import(
  'data:text/javascript;base64,' + Buffer.from(thumbnailSource, 'utf8').toString('base64')
);

const RealURL = globalThis.URL;
let revoked = false;
globalThis.URL = class ThumbnailTestURL extends RealURL {
  static createObjectURL() { return 'blob:thumb'; }
  static revokeObjectURL() { revoked = true; }
};

let drawn = false;
const listeners = new Map();
function emit(name) {
  const handlers = listeners.get(name);
  if (!handlers) return;
  for (const handler of [...handlers]) handler();
}
const video = {
  preload: '',
  muted: false,
  playsInline: false,
  duration: 12.5,
  videoWidth: 640,
  videoHeight: 360,
  _currentTime: 0,
  get currentTime() { return this._currentTime; },
  set currentTime(value) {
    this._currentTime = value;
    queueMicrotask(() => emit('seeked'));
  },
  _src: '',
  get src() { return this._src; },
  set src(value) {
    this._src = value;
    setTimeout(() => emit('loadeddata'), 0);
  },
  addEventListener(name, handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
  },
  removeEventListener(name, handler) {
    listeners.get(name)?.delete(handler);
  },
  removeAttribute() {},
  load() {},
  pause() {}
};
const canvas = {
  width: 0,
  height: 0,
  getContext(type) {
    assert.equal(type, '2d');
    return { drawImage() { drawn = true; } };
  },
  toDataURL(type, quality) {
    assert.equal(type, 'image/jpeg');
    assert.ok(quality > 0 && quality <= 1);
    return 'data:image/jpeg;base64,thumb';
  }
};

globalThis.document = {
  createElement(tag) {
    if (tag === 'video') return video;
    if (tag === 'canvas') return canvas;
    throw new Error(`unexpected element: ${tag}`);
  }
};

const result = await thumbnailModule.captureVideoThumbnail({ name: 'clip.mp4' });
assert.equal(result.duration, 12.5);
assert.equal(result.thumbnail, 'data:image/jpeg;base64,thumb');
assert.equal(video.currentTime, 0.2);
assert.equal(drawn, true);
assert.equal(revoked, true);
assert.equal(canvas.width, 160);
assert.equal(canvas.height, 90);

console.log('thumbnail capture wiring passed');
