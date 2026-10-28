import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const regionStart = clientSource.indexOf('// #region video-probe');
const regionEnd = clientSource.indexOf('// #endregion', regionStart);
assert.ok(regionStart >= 0 && regionEnd > regionStart, 'probe region markers must exist');
const probeSource = clientSource.slice(regionStart, regionEnd) + '\nexport { probeMp4 };\n';
const probeModule = await import(
  'data:text/javascript;base64,' + Buffer.from(probeSource, 'utf8').toString('base64')
);

const bytes = readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url));
const file = new File([bytes], 'tiny.mp4', { type: 'video/mp4' });
const result = await probeModule.probeMp4(file);

assert.equal(result.container.durationSec, 1);
assert.equal(result.container.trackCount, 2);
assert.equal(result.video.codec, 'H.264 / AVC');
assert.equal(result.video.profile, 'Baseline');
assert.ok(result.video.level.startsWith('1.'));
assert.equal(result.video.width, 64);
assert.equal(result.video.height, 36);
assert.equal(result.video.frameCount, 10);
assert.equal(result.video.fps, 10);
assert.ok(result.video.bitrate > 0);
assert.equal(result.audio.codec, 'AAC');
assert.equal(result.audio.profile, 'AAC LC');
assert.equal(result.audio.sampleRate, 44100);
assert.equal(result.audio.channels, 1);
assert.ok(result.audio.bitrate > 0);

console.log('MP4/MOV probe fixture passed');
