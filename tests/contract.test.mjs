import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8');
const en = JSON.parse(readFileSync(new URL('locale/en.json', root), 'utf8'));
const zh = JSON.parse(readFileSync(new URL('locale/zh.json', root), 'utf8'));
const icon = readFileSync(new URL('icon.svg', root), 'utf8');

assert.equal(pkg.name, 'dsh-sidebar-video-player');
assert.equal(pkg.type, 'module');
assert.equal(pkg.license, 'MIT');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
assert.ok(pkg.engines.dsh.includes('0.2.1'));
assert.equal(pkg.exports['./client'], './client.js');
assert.equal(pkg.exports['./icon'], './icon.svg');
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'LICENSE']) {
  assert.ok(existsSync(new URL(file, root)), `${file} must exist`);
}
assert.ok(patch.includes('id: dsh-sidebar-video-player'));
assert.ok(patch.includes("name: 'dsh-sidebar-video-player'"));
assert.equal(typeof en.meta.title, 'string');
assert.equal(typeof en.meta.description, 'string');
assert.equal(typeof zh.meta.title, 'string');
assert.equal(typeof zh.meta.description, 'string');
assert.ok(icon.trimStart().startsWith('<svg'));
assert.ok(Buffer.byteLength(icon) < 256 * 1024);

let plugin = null;
globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      assert.equal(config.id, 'dsh-sidebar-video-player');
      plugin = config.factory((name) => {
        assert.equal(name, 'react');
        return {
          createElement() { return null; },
          useRef() { return { current: null }; },
          useState() { return [null, () => {}]; },
          useEffect() {},
          useCallback(fn) { return fn; },
          useMemo(fn) { return fn(); },
          useSyncExternalStore() { return undefined; }
        };
      });
    }
  }
};

await import(new URL('../client.js', import.meta.url).href);
assert.ok(plugin, 'the module loader must receive a factory');
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(plugin.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']);

const registrations = new Map();
const definitions = [];
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
  sidebarRightTabs: {
    register: (definition) => {
      definitions.push(definition);
      return () => {};
    }
  },
  sidebarRight: {
    mounted: {
      subscribe: () => () => {},
      getSnapshot: () => 'session-1'
    },
    openTab: () => {}
  }
};

plugin.apply(ctx);

assert.equal(definitions.length, 1);
assert.equal(definitions[0].id, 'dsh-sidebar-video-player');
assert.equal(definitions[0].kind, 'video-player');
assert.equal(definitions[0].priority, 'extension');
assert.equal(definitions[0].keepMounted, true);
assert.equal(definitions[0].guide.length, 1);
assert.equal(typeof definitions[0].title, 'function');
assert.equal(typeof definitions[0].guide[0].title, 'function');
assert.equal(typeof definitions[0].guide[0].description, 'function');
assert.equal(typeof definitions[0].guide[0].icon, 'function');

assert.equal(typeof registrations.get('sidebar.right.pane.tab:dsh-sidebar-video-player'), 'function');
assert.equal(typeof registrations.get('sidebar.right.pane.tab.title:dsh-sidebar-video-player'), 'function');
assert.equal(typeof registrations.get('sidebar.footer.action:dsh-sidebar-video-player'), 'function');

console.log('manifest and registration contract passed');
