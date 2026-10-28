import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const regionStart = clientSource.indexOf('// #region file-ops');
const regionEnd = clientSource.indexOf('// #endregion', regionStart);
assert.ok(regionStart >= 0 && regionEnd > regionStart, 'file-ops region markers must exist');
const code = clientSource.slice(regionStart, regionEnd) + `
  function isVideoFile(file) { return /\\.mp4$/i.test(file.name); }
  function playlistItem(file, handle, parentHandle, path) {
    return { file, handle, parentHandle, path, name: file.name, key: path, size: file.size, type: file.type };
  }
  function comparePlaylistItems(left, right) { return left.path.localeCompare(right.path); }
  export { fileExists, splitFileName, parentPathOf, copyVideoFile, renameVideoFile, enumerateVideoHandles };
`;
const ops = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));

assert.deepEqual(ops.splitFileName('clip.mp4'), ['clip', '.mp4']);
assert.deepEqual(ops.splitFileName('clip'), ['clip', '']);
assert.equal(ops.parentPathOf('clips/sub/a.mp4'), 'clips/sub/');
assert.equal(ops.parentPathOf('a.mp4'), '');

const writes = [];
const removed = [];
const existing = new Set(['clip (copy).mp4']);
const directory = {
  async getFileHandle(name, options) {
    if (options && options.create) {
      return {
        name,
        async createWritable() {
          return {
            async write(value) { writes.push(value); },
            async close() { writes.push('closed'); }
          };
        }
      };
    }
    if (existing.has(name)) return { name };
    const error = new Error('missing');
    error.name = 'NotFoundError';
    throw error;
  },
  async removeEntry(name) { removed.push(name); }
};

assert.equal(await ops.fileExists(directory, 'clip (copy).mp4'), true);
assert.equal(await ops.fileExists(directory, 'missing.mp4'), false);

const file = {
  stream() {
    return {
      async pipeTo(writable) {
        await writable.write('video-bytes');
        await writable.close();
      }
    };
  }
};
const item = { name: 'clip.mp4', file, parentHandle: directory, handle: null };
const copyName = await ops.copyVideoFile(item, 'copy');
assert.equal(copyName, 'clip (copy 2).mp4');
assert.deepEqual(writes, ['video-bytes', 'closed']);

let movedTo = '';
const handledItem = {
  ...item,
  handle: { async move(name) { movedTo = name; } }
};
await ops.renameVideoFile(handledItem, 'renamed.mp4');
assert.equal(movedTo, 'renamed.mp4');

writes.length = 0;
const fallbackItem = { ...item, handle: {} };
await ops.renameVideoFile(fallbackItem, 'fallback.mp4');
assert.deepEqual(writes, ['video-bytes', 'closed']);
assert.deepEqual(removed, ['clip.mp4']);

const subdirectory = {
  async *values() {
    yield {
      kind: 'file',
      name: 'b.mp4',
      getFile: async () => ({ name: 'b.mp4', type: 'video/mp4', size: 2, lastModified: 2 })
    };
  }
};
const root = {
  async *values() {
    yield {
      kind: 'file',
      name: 'a.mp4',
      getFile: async () => ({ name: 'a.mp4', type: 'video/mp4', size: 1, lastModified: 1 })
    };
    yield {
      kind: 'file',
      name: 'notes.txt',
      getFile: async () => ({ name: 'notes.txt', type: 'text/plain', size: 1, lastModified: 1 })
    };
    yield { kind: 'directory', name: 'sub', ...subdirectory };
  }
};
const enumerated = await ops.enumerateVideoHandles(root);
assert.deepEqual(enumerated.map((entry) => entry.path), ['a.mp4', 'sub/b.mp4']);

console.log('file operation helpers passed');
