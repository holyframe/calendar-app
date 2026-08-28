import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);

test('every popup DOM lookup resolves to exactly one element ID', async () => {
  const html = await readFile(new URL('popup/popup.html', project), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'popup contains duplicate IDs');

  for (const filename of [
    'popup/popup.js',
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
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  await Promise.all([...new Set(paths)].map((path) => access(new URL(path, project))));
});

test('fresh installs default to the custom ordinal output format', async () => {
  const source = await readFile(new URL('popup/popup.js', project), 'utf8');

  assert.match(source, /outputPreset:\s*'custom'/);
  assert.match(source, /outputTemplate:\s*'\{Dow3\} \{Do\} : \{times\}'/);
  assert.match(source, /outputTimeStyle:\s*'spacedDots'/);
});

test('runtime code has no inherited brand, broad scope, sync storage, or Events endpoint', async () => {
  const paths = [
    'manifest.json',
    'background/service_worker.js',
    'popup/popup.html',
    'popup/popup.js',
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
  assert.doesNotMatch(runtime, /\/calendars\/[^\s]+\/events/);
});
