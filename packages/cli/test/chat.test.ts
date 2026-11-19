import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { openRoom, readCursors, sendMessage, takeUnread, waitUnread } from '../src/chat';
import { makeProject } from './fixture';

let cleanup = () => {};
afterEach(() => cleanup());

function room() {
  const p = makeProject();
  cleanup = p.cleanup;
  return { dir: p.dir, r: openRoom(p.dir) };
}

test('send gives seq 1, 2, 3; a sender gets no own message and keeps what came while it was busy; read --unread moves the cursor', () => {
  const { r } = room();
  expect(sendMessage(r, { from: 'designer', to: 'claude', body: 'spec' }).seq).toBe(1);
  expect(sendMessage(r, { from: 'claude', body: 'ok' }).seq).toBe(2);
  expect(sendMessage(r, { from: 'designer', to: 'human', body: 'your call?', needsHuman: true }).seq).toBe(3);
  // claude: #1 (to claude); not #2 (its own), not #3 (to the human)
  expect(takeUnread(r, 'claude').map((m) => m.seq)).toEqual([1]);
  expect(readCursors(r).claude).toBe(3);
  expect(takeUnread(r, 'claude')).toEqual([]);
  // the human gets #2 (to all) and #3; a peek leaves the cursor
  expect(takeUnread(r, 'human', { peek: true }).map((m) => m.seq)).toEqual([2, 3]);
  expect(takeUnread(r, 'human').map((m) => m.seq)).toEqual([2, 3]);
  expect(takeUnread(r, 'human', { after: 1 }).map((m) => m.seq)).toEqual([2, 3]);
});

test('wait returns a message that came before it started, and wakes on a send while it waits', async () => {
  const { r } = room();
  sendMessage(r, { from: 'designer', body: 'early' });
  expect((await waitUnread(r, 'claude', 1)).map((m) => m.body)).toEqual(['early']);
  const t0 = performance.now();
  // waitUnread reads the room and starts its watch before its first await: these sends come while it waits
  const pending = waitUnread(r, 'claude', 10);
  sendMessage(r, { from: 'claude', body: 'mine' });
  sendMessage(r, { from: 'designer', to: 'claude', body: 'late' });
  expect((await pending).map((m) => m.body)).toEqual(['late']);
  // the watch wakes it, not the 2 s poll
  expect(performance.now() - t0).toBeLessThan(1500);
});

test('pve chat wait exits 3 at the timeout; send -m - reads stdin', async () => {
  const { dir } = room();
  const main = path.join(import.meta.dir, '../src/main.ts');
  const wait = Bun.spawn([process.execPath, main, 'chat', 'wait', '-p', dir, '--as', 'claude', '--timeout', '0.3'], { stdout: 'pipe', stderr: 'pipe' });
  expect(await wait.exited).toBe(3);
  const send = Bun.spawn([process.execPath, main, 'chat', 'send', '-p', dir, '--as', 'designer', '-m', '-'], { stdin: new Blob(['a `spec` with "quotes"\n']), stdout: 'pipe' });
  expect(await send.exited).toBe(0);
  expect(await new Response(send.stdout).text()).toBe('sent #1\n');
  expect(takeUnread(openRoom(dir), 'claude').map((m) => m.body)).toEqual(['a `spec` with "quotes"\n']);
});
