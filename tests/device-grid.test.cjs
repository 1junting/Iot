const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8');

function setup() {
  const elements = new Map();
  const grid = {
    writes: 0,
    get innerHTML() { return this.markup || ''; },
    set innerHTML(value) { this.markup = value; this.writes += 1; },
  };
  elements.set('#deviceGrid', grid);
  elements.set('#deviceSearch', { value: '' });
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, {});
        return elements.get(selector);
      },
      addEventListener() {},
    },
    localStorage: { getItem() { return null; } },
  });
  vm.runInContext(source, context);
  return { grid, elements, run: code => vm.runInContext(code, context) };
}

test('unchanged polling preserves device cards while counters still update', () => {
  const { grid, elements, run } = setup();
  run('renderDevices()');
  assert.equal(grid.writes, 1);
  for (let index = 0; index < 10; index += 1) {
    run('state.status.sent += 1; renderDevices()');
  }
  assert.equal(grid.writes, 1);
  run("state.status.runs = [{name: 'Unrelated sensor', protocol: 'mqtt'}]; renderDevices()");
  assert.equal(grid.writes, 1);
  assert.equal(elements.get('#navRunCount').textContent, 1);
});

test('starting and stopping a device updates its visible status', () => {
  const { grid, run } = setup();
  run('renderDevices()');
  run("state.status.runs = [{name: 'TEMP-LAB', protocol: 'mqtt'}]; renderDevices()");
  assert.equal(grid.writes, 2);
  assert.match(grid.innerHTML, /data-stop-device="temp-lab"/);
  run('renderDevices()');
  assert.equal(grid.writes, 2);
  run('state.status.runs = []; renderDevices()');
  assert.equal(grid.writes, 3);
  assert.match(grid.innerHTML, /data-start-device="temp-lab"/);
});

test('editing device or payload settings still redraws the cards', () => {
  const { grid, run } = setup();
  run('renderDevices()');
  run("state.devices[0].target.port = 1884; renderDevices()");
  assert.equal(grid.writes, 2);
  assert.match(grid.innerHTML, /broker:1884/);
  run("state.templates[0].name = 'Updated payload'; renderDevices()");
  assert.equal(grid.writes, 3);
  assert.match(grid.innerHTML, /Updated payload/);
  run("state.devices[0].name = 'New name'; state.devices[0].count = 2; renderDevices()");
  assert.equal(grid.writes, 4);
  assert.match(grid.innerHTML, /New name/);
  assert.match(grid.innerHTML, /2 DEVICES/);
});

test('search, empty results and returning to the full list still work', () => {
  const { grid, elements, run } = setup();
  run('renderDevices()');
  elements.get('#deviceSearch').value = 'motor';
  run('renderDevices()');
  assert.equal(grid.writes, 2);
  assert.match(grid.innerHTML, /MOTOR-LINE-A/);
  assert.doesNotMatch(grid.innerHTML, /TEMP-LAB/);
  elements.get('#deviceSearch').value = 'no matching sensor';
  run('renderDevices()');
  assert.equal(grid.writes, 3);
  assert.match(grid.innerHTML, /找不到裝置/);
  run('renderDevices()');
  assert.equal(grid.writes, 3);
  elements.get('#deviceSearch').value = '';
  run('renderDevices()');
  assert.equal(grid.writes, 4);
  assert.equal((grid.innerHTML.match(/class="device-card"/g) || []).length, 3);
});
