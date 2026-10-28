import assert from 'node:assert/strict';

let plugin = null;
const states = [];
const refs = [];
let hookIndex = 0;
let dirty = false;

const React = {
  createElement(type, props, ...children) {
    const nextProps = Object.assign({}, props);
    if (children.length === 1) nextProps.children = children[0];
    else if (children.length > 1) nextProps.children = children;
    return { type, props: nextProps };
  },
  useRef(initial) {
    const index = hookIndex;
    hookIndex += 1;
    if (!refs[index]) refs[index] = { current: initial };
    return refs[index];
  },
  useState(initial) {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (value) => {
      states[index] = typeof value === 'function' ? value(states[index]) : value;
      dirty = true;
    }];
  },
  useEffect() {},
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); }
};

globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      plugin = config.factory((name) => {
        assert.equal(name, 'react');
        return React;
      });
    }
  }
};

const RealURL = globalThis.URL;
let blobId = 0;
globalThis.URL = class VideoPlayerTestURL extends RealURL {
  static createObjectURL() {
    blobId += 1;
    return `blob:test-${blobId}`;
  }
  static revokeObjectURL() {}
};

globalThis.document = {
  pictureInPictureEnabled: false,
  fullscreenElement: null,
  createElement() {
    return { dataset: {}, textContent: '', remove() {} };
  },
  head: { appendChild() {} }
};

await import(new URL('../client.js', import.meta.url).href);
assert.ok(plugin);

const registrations = new Map();
const ctx = {
  locale: {
    bind: () => (key) => key,
    register: () => () => {}
  },
  effect: (fn) => {
    fn();
    return () => {};
  },
  slots: {
    inject: (_name, callback) => {
      callback();
      return () => {};
    },
    register: (options, component) => {
      registrations.set(`${options.name}:${options.key || options.id}`, component);
      return () => {};
    }
  },
  sidebarRightTabs: { register: () => () => {} },
  sidebarRight: { mounted: { subscribe: () => () => {}, getSnapshot: () => undefined }, openTab: () => {} }
};

plugin.apply(ctx);
const VideoPanel = [...registrations.entries()]
  .find(([key]) => key.startsWith('sidebar.right.pane.tab:'))?.[1];
assert.equal(typeof VideoPanel, 'function');

function render() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    hookIndex = 0;
    dirty = false;
    const tree = VideoPanel({
      t: (key) => key,
      useTabInfo: () => ({ tab: { visible: true, title: 'demo' } })
    });
    if (!dirty) return tree;
  }
  throw new Error('render did not settle');
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  const children = node.props && node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  } else {
    walk(children, visit);
  }
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

const firstTree = render();
const folderInput = findAll(firstTree, (node) => node.type === 'input' && node.props && 'webkitdirectory' in node.props)[0];
assert.ok(folderInput, 'the empty state must expose a folder input');
assert.ok(findAll(firstTree, (node) => node.props && node.props.className === 'dsh-vp-empty-actions').length === 1);

const files = [
  { name: 'b.webm', type: 'video/webm', size: 20, lastModified: 2, webkitRelativePath: 'clips/b.webm' },
  { name: 'a.webm', type: 'video/webm', size: 10, lastModified: 1, webkitRelativePath: 'clips/a.webm' },
  { name: 'note.txt', type: 'text/plain', size: 1, lastModified: 0, webkitRelativePath: 'clips/note.txt' }
];
folderInput.props.onChange({ target: { files, value: '' } });
const playlistTree = render();

const panel = findAll(playlistTree, (node) => node.props && node.props.className === 'dsh-vp-playlist');
assert.equal(panel.length, 1, 'a playlist panel must render to the right of the player');
const items = findAll(playlistTree, (node) => node.props && String(node.props.className || '').includes('dsh-vp-playlist-item'));
assert.equal(items.length, 2, 'only video files enter the playlist');
const names = findAll(playlistTree, (node) => node.props && node.props.className === 'dsh-vp-playlist-name')
  .map((node) => node.props.children);
assert.deepEqual(names, ['a.webm', 'b.webm'], 'playlist is sorted by relative path');
assert.ok(String(items[0].props.className).includes('dsh-vp-playlist-item-active'));
assert.equal(findAll(playlistTree, (node) => node.props && node.props.className === 'dsh-vp-playlist-count')[0].props.children, '2');

const firstVideo = findAll(playlistTree, (node) => node.type === 'video')[0];
assert.equal(firstVideo.props.src, 'blob:test-1');
assert.equal(firstVideo.props.autoPlay, false);

items[1].props.onClick();
const switchedTree = render();
const secondVideo = findAll(switchedTree, (node) => node.type === 'video')[0];
assert.equal(secondVideo.props.src, 'blob:test-2');
assert.equal(secondVideo.props.autoPlay, true);
const activeItems = findAll(switchedTree, (node) => node.props && String(node.props.className || '').includes('dsh-vp-playlist-item-active'));
assert.equal(activeItems.length, 1);
assert.ok(String(activeItems[0].props.className).includes('dsh-vp-playlist-item-active'));

console.log('playlist folder selection and switching passed');
