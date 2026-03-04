import React, { useEffect, useState } from 'react';
import { initGoogleApis, signInGetToken, type GoogleSession, createFolder, createJsonFile, driveJson, ensureChildFolder } from '../lib/google';
import { loadPicker, pickFolder } from '../lib/picker';
import { Link } from 'react-router-dom';
import { initGoogleApis, signInGetToken, ensureFreshToken, type GoogleSession, ... } from '../lib/google';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

type LocalState = { session?: GoogleSession; rootFolderId?: string; sitesFolderId?: string; };
type SiteIndexEntry = { key: string; name: string; customer: string; city: string; folderId: string };

const LS_KEY = 'sls_drive_state_v3';

function loadState(): LocalState { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function saveState(s: LocalState) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

async function createRootAndSites(session: GoogleSession) {
  const rootFolderId = await createFolder(session, 'SLS Lighting Inspections (Private)');
  const sitesFolderId = await ensureChildFolder(session, rootFolderId, 'Sites');
  return { rootFolderId, sitesFolderId };
}

async function initSiteFolder(session: GoogleSession, sitesFolderId: string, folderName: string) {
  const siteFolderId = await createFolder(session, folderName, sitesFolderId);
  await ensureChildFolder(session, siteFolderId, 'Base Maps');
  const dataId = await ensureChildFolder(session, siteFolderId, 'Data');
  await ensureChildFolder(session, siteFolderId, 'Inspections');
  await createJsonFile(session, 'layers.json', dataId, []);
  await createJsonFile(session, 'assets.json', dataId, []);
  await createJsonFile(session, 'zones.json', dataId, []);
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<LocalState>(() => loadState());
  const [status, setStatus] = useState('');
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);

  useEffect(() => {
    (async () => {
      setStatus('Loading Google libraries…');
      await initGoogleApis();
      // If we have a saved session, refresh it; if refresh fails, clear it and require login.
const saved = loadState();
if (saved.session) {
  try {
    const fresh = await ensureFreshToken(saved.session, CLIENT_ID);
    const next = { ...saved, session: fresh };
    setState(next);
    saveState(next);
  } catch {
    localStorage.removeItem(LS_KEY);
    setState({});
  }
}
      setReady(true);
      setStatus('');
    })();
  }, []);

  async function signIn() {
    setStatus('Signing in…');
    const session = await signInGetToken(CLIENT_ID);
    const next = { ...state, session };
    setState(next); saveState(next);
    setStatus('');
  }

  async function createPrivateRoot() {
    if (!state.session) return;
    setStatus('Creating private folder structure…');
    const { rootFolderId, sitesFolderId } = await createRootAndSites(state.session);
    const next = { ...state, rootFolderId, sitesFolderId };
    setState(next); saveState(next);
    setStatus('');
  }

  async function pickRoot() {
    if (!state.session) return;
    setStatus('Loading picker…');
    await loadPicker(API_KEY);
    const folderId = await pickFolder(API_KEY, APP_ID, state.session);
    setStatus('Ensuring Sites folder…');
    const sitesFolderId = await ensureChildFolder(state.session, folderId, 'Sites');
    const next = { ...state, rootFolderId: folderId, sitesFolderId };
    setState(next); saveState(next);
    setStatus('');
  }

  async function refreshSites() {
    if (!state.session || !state.sitesFolderId) return;
    setStatus('Listing sites…');
    const q = encodeURIComponent(`'${state.sitesFolderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`);
    const res = await driveJson<any>(state.session, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const entries: SiteIndexEntry[] = (res.files || []).map((f:any) => {
      const parts = String(f.name).split(' - ');
      return { key: f.id, name: parts[0] || f.name, customer: parts[1] || '', city: parts[2] || '', folderId: f.id };
    });
    setSites(entries);
    setStatus('');
  }

  useEffect(() => { refreshSites(); }, [state.session?.accessToken, state.sitesFolderId]);

  async function newSite() {
    if (!state.session || !state.sitesFolderId) return;
    const siteName = prompt('Site Name?') || '';
    const customer = prompt('Customer?') || '';
    const city = prompt('City?') || '';
    if (!siteName.trim() || !customer.trim() || !city.trim()) return;

    const folderName = `${siteName.trim()} - ${customer.trim()} - ${city.trim()}`;
    setStatus(`Creating: ${folderName}…`);
    await initSiteFolder(state.session, state.sitesFolderId, folderName);
    setStatus('');
    await refreshSites();
  }

  return (
    <div style={{padding:16, display:'grid', gap:12}}>
      <div className="card">
        <h2 style={{marginTop:0}}>Setup</h2>
        <div className="small">Each tech uses their own Drive. Nothing is shared unless they share it.</div>

        {!state.session ? (
          <button className="btn primary" onClick={signIn} disabled={!ready}>Sign in with Google</button>
        ) : (
          <div className="row">
            {!state.rootFolderId ? (
              <>
                <button className="btn primary" onClick={createPrivateRoot}>Create private folder structure</button>
                <button className="btn" onClick={pickRoot}>Or pick an existing folder</button>
              </>
            ) : (
              <div className="small">Root folder set ✓</div>
            )}
            <button className="btn" onClick={refreshSites} disabled={!state.sitesFolderId}>Refresh sites</button>
          </div>
        )}

        {status && <div className="small" style={{marginTop:10}}>{status}</div>}
      </div>

      <div className="card">
        <div className="row" style={{justifyContent:'space-between'}}>
          <h2 style={{margin:0}}>Sites</h2>
          <button className="btn primary" onClick={newSite} disabled={!state.sitesFolderId}>New Site</button>
        </div>
        <div className="small">Folder naming: <code>{'{Site Name} - {Customer} - {City}'}</code></div>

        <div style={{display:'grid', gap:10, marginTop:12}}>
          {sites.length === 0 && <div className="small">No sites yet.</div>}
          {sites.map(s => (
            <div key={s.key} className="card" style={{padding:12}}>
              <div style={{fontWeight:700}}>{s.name}</div>
              <div className="small">{s.customer} • {s.city}</div>
              <div className="row" style={{marginTop:8}}>
                <Link className="btn" to={`/site/${encodeURIComponent(s.folderId)}`}>Open</Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="small">
        Env vars needed: <code>VITE_GOOGLE_CLIENT_ID</code>, <code>VITE_GOOGLE_API_KEY</code>.
      </div>
    </div>
  );
}
