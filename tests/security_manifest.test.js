import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const workerUrl = new URL('../background/service_worker.js', import.meta.url);

test('manifest has its own stable identity and no Web Store update channel', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.name, 'Private Calendar Availability');
  assert.ok(manifest.key);
  assert.notEqual(
    manifest.key,
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApcE/Kgwdgp+v/W3rJOp/D2xMJy7SFMgeSyBnP4hDbyo32fwnIohP/tkXOoQdLntG9UC9JIt36xDcTxg9LOx8YVPbxJ/i/1P7eLTaR7Prn5GatwRz/vKp2pEK/xqeQPFTSgcWbuOF8tTmpnCDYz8sKh0daIA60oYl9b1FyIdmtGfSlsw56rg+kC8ONud2mNVGgQkfCJQlCWW0lZl7lzNXhdMJ+Q/6mdO9joMDRJ+XZ0pbQJC61GIotyV45oq/eerSNu9qAUOp/EV20YENRlbUKFQfsuiJz21beUjAlietc5DB2GEdCSRu7UVhKFk4wHAFoZ0Cw5dweyfHUzNgyj40VQIDAQAB'
  );
  const digest = createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32);
  const extensionId = [...digest]
    .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16)))
    .join('');
  assert.equal(extensionId, 'dcnikakndffhkejpelbgcdfjbmimaikm');
  assert.equal(manifest.update_url, undefined);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.content_scripts, undefined);
});

test('OAuth scopes are least-privilege and read-only', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.deepEqual(manifest.oauth2.scopes, [
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
  assert.equal(
    manifest.oauth2.scopes.some((scope) => scope.endsWith('/auth/calendar.readonly')),
    false
  );
  assert.equal(
    manifest.oauth2.scopes.some((scope) =>
      [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ].includes(scope)
    ),
    false
  );
});

test('background gateway uses FreeBusy and a field-limited Events list', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /\/freeBusy/);
  assert.match(source, /\/events/);
  assert.match(source, /singleEvents', 'true'/);
  assert.match(
    source,
    /items\(id,iCalUID,summary,description,start\(date,dateTime\),end\(date,dateTime\)\),nextPageToken/
  );
  assert.match(source, /GET_TODAY_SCHEDULE/);
  assert.doesNotMatch(source, /GET_TOKEN/);
  assert.match(source, /chrome\.storage\.session/);
});

test('Today reads all calendars while availability uses selected calendars', async () => {
  const source = await readFile(workerUrl, 'utf8');
  const scheduleStart = source.indexOf('async function fetchAccountSchedule');
  const scheduleEnd = source.indexOf('async function handleGetBusy', scheduleStart);
  const scheduleSource = source.slice(scheduleStart, scheduleEnd);

  assert.match(scheduleSource, /fetchCalendarList\(token\)/);
  assert.doesNotMatch(scheduleSource, /getCheckedCalendars/);
  assert.match(source, /async function fetchAccountBusy[\s\S]+getCheckedCalendars/);
});
