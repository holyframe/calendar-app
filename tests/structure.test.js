import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);

test('every side-panel DOM lookup resolves to exactly one element ID', async () => {
  const html = await readFile(new URL('popup/popup.html', project), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'side panel contains duplicate IDs');

  for (const filename of [
    'popup/popup.js',
    'popup/today.js',
    'popup/pick_dates.js',
    'popup/date_range.js',
    'popup/settings.js',
  ]) {
    const source = await readFile(new URL(filename, project), 'utf8');
    for (const match of source.matchAll(/\$\('([^']+)'\)/g)) {
      assert.ok(ids.includes(match[1]), `${filename} references missing #${match[1]}`);
    }
  }
});

test('manifest-referenced extension assets exist', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', project), 'utf8')
  );
  const paths = [
    manifest.side_panel.default_path,
    manifest.background.service_worker,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  await Promise.all([...new Set(paths)].map((path) => access(new URL(path, project))));
});

test('toolbar action opens a global side panel', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', project), 'utf8')
  );
  const worker = await readFile(
    new URL('background/service_worker.js', project),
    'utf8'
  );

  assert.equal(manifest.side_panel.default_path, 'popup/popup.html');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.action.default_popup, undefined);
  assert.match(worker, /setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/);
});

test('fresh installs default to the custom ordinal output format', async () => {
  const source = await readFile(new URL('popup/popup.js', project), 'utf8');

  assert.match(source, /outputPreset:\s*'custom'/);
  assert.match(source, /outputTemplate:\s*'\{Dow3\} \{Do\} : \{times\}'/);
  assert.match(source, /outputTimeStyle:\s*'spacedDots'/);
  assert.match(source, /todayViewStart:\s*'08:00'/);
  assert.match(source, /todayViewEnd:\s*'20:00'/);
});

test('today timeline uses an hourly range bar', async () => {
  const html = await readFile(new URL('popup/popup.html', project), 'utf8');

  assert.match(html, /type="range" id="today-view-start"[^>]+step="1"/);
  assert.match(html, /type="range" id="today-view-end"[^>]+step="1"/);
  assert.match(html, /id="today-view-range-output"/);
});

test('Today preserves its grid while schedule data refreshes', async () => {
  const source = await readFile(new URL('popup/today.js', project), 'utf8');

  assert.doesNotMatch(source, /Loading today’s schedule/);
  assert.match(source, /renderedScheduleKey !== viewKey/);
  assert.match(source, /renderSchedule\(cached\?\.events \|\| \[\], timeZone, dayWindow, viewWindow\)/);
  assert.match(source, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(source, /scheduleCache\.get\(viewKey\)/);
});

test('runtime code has no inherited brand, broad scope, or sync storage', async () => {
  const paths = [
    'manifest.json',
    'background/service_worker.js',
    'popup/popup.html',
    'popup/popup.js',
    'popup/today.js',
    'popup/pick_dates.js',
    'popup/date_range.js',
    'popup/settings.js',
    'utils/calendar_api.js',
  ];
  const runtime = (
    await Promise.all(paths.map((path) => readFile(new URL(path, project), 'utf8')))
  ).join('\n');

  assert.doesNotMatch(runtime, /Availical/i);
  assert.doesNotMatch(runtime, /977927049542-/);
  assert.doesNotMatch(runtime, /chrome\.storage\.sync/);
  assert.doesNotMatch(runtime, /\/auth\/calendar\.readonly/);
  assert.doesNotMatch(runtime, /\/auth\/calendar(?:\.events)?["']/);
});
