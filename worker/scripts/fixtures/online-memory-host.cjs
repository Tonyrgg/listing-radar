// Isolated Electron host: all cloud requests use a file-backed fake; portals are inaccessible.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', process.env.TERRITORY_ONLINE_TEST_DIR);
const cloudFile = process.env.TERRITORY_ONLINE_CLOUD_FILE;
const ownerId = 'be0e3d14-4b90-41b9-83b5-43a683fc2523';
global.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://memorytest.supabase.co') throw new Error('External services excluded from test');
  try { await fs.access(`${cloudFile}.offline`); throw new Error('Offline test'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let remote = null;
  try { remote = JSON.parse(await fs.readFile(cloudFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (url.pathname === '/auth/v1/admin/users') return Response.json({ users: [{ id: ownerId }] });
  if (url.pathname === '/rest/v1/territory_lab_workspaces') return Response.json(url.searchParams.get('select') === 'id' ? (remote ? [{ id: remote.id }] : []) : remote);
  const { syncRecords, recordsState, diffRecords } = await import(pathToFileURL(path.join(process.env.WORKER_V2_TEST_ROOT, 'dist-desktop/territory/sync-records.js')).href);
  if (url.pathname === '/rest/v1/rpc/read_territory_workspace_changes') {
    const args = JSON.parse(init.body);
    const rows = remote?.records ?? (remote ? [...syncRecords(remote.state).values()].map(row => ({ row, revision: remote.revision })) : []);
    return Response.json({ revision: remote?.revision ?? 0, changes: rows.filter(r => r.revision > args.p_since).map(r => r.row) });
  }
  if (['/rest/v1/rpc/save_territory_lab_workspace','/rest/v1/rpc/save_territory_workspace_changes'].includes(url.pathname)) {
    const args = JSON.parse(init.body);
    if ((remote?.revision ?? 0) !== args.p_expected_revision) return Response.json({ code: '40001' }, { status: 409 });
    const records = remote ? syncRecords(remote.state) : new Map();
    const patch = args.p_changes ?? (remote ? diffRecords(remote.state, args.p_state) : [...syncRecords(args.p_state).values()]);
    const versions = new Map((remote?.records ?? []).map(v => [JSON.stringify([v.row.collection,v.row.key]),v]));
    for (const row of patch) { const id = JSON.stringify([row.collection,row.key]); if (row.deleted) records.delete(id); else records.set(id,row); versions.set(id,{row,revision:(remote?.revision??0)+1}); }
    remote = { id: args.p_workspace_id, owner_id: args.p_owner_id, profile_kind: args.p_profile_kind, revision: (remote?.revision ?? 0) + 1, state: recordsState(records), records: [...versions.values()] };
    await fs.writeFile(cloudFile, JSON.stringify(remote)); return Response.json(remote.revision);
  }
  throw new Error('Unexpected test endpoint');
};
void app.whenReady().then(async () => {
  const directory = process.env.TERRITORY_ONLINE_TEST_DIR;
  const assetDirectory = path.join(process.env.WORKER_V2_TEST_ROOT, 'dist-desktop/territory');
  const window = new BrowserWindow({ show: false, width: 1400, height: 880, webPreferences: { preload: path.join(assetDirectory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const { openTerritorySession } = await import(pathToFileURL(path.join(assetDirectory, 'session.js')).href);
  const session = await openTerritorySession({ profileDirectory: directory, assetDirectory, live: true, integrated: true, contents: window.webContents, parent: window, onlineCredentials: () => ({ url: 'https://memorytest.supabase.co', key: 'dummy-key-excluded-from-profile' }) });
  let closed = false;
  window.on('close', event => { if (closed) return; event.preventDefault(); void session.close().then(() => { closed = true; window.close(); app.quit(); }); });
  await window.loadFile(path.join(assetDirectory, 'renderer/index.html'));
});
