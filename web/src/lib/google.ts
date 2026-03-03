export type GoogleSession = {
  accessToken: string;
  expiresAt: number;
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

declare global {
  interface Window { google?: any; gapi?: any; }
}

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function initGoogleApis() {
  await loadScript('https://accounts.google.com/gsi/client');
  await loadScript('https://apis.google.com/js/api.js');
}

export async function signInGetToken(clientId: string): Promise<GoogleSession> {
  if (!window.google?.accounts?.oauth2) throw new Error('GIS not loaded');
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error));
        const expiresIn = Number(resp.expires_in || 3600);
        resolve({ accessToken: resp.access_token, expiresAt: Date.now() + expiresIn*1000 - 60_000 });
      }
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function ensureFreshToken(session: GoogleSession, clientId: string): Promise<GoogleSession> {
  if (session.expiresAt > Date.now()) return Promise.resolve(session);
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error));
        const expiresIn = Number(resp.expires_in || 3600);
        resolve({ accessToken: resp.access_token, expiresAt: Date.now() + expiresIn*1000 - 60_000 });
      }
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export async function driveFetch(session: GoogleSession, url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  return fetch(url, { ...init, headers });
}

export async function driveJson<T>(session: GoogleSession, url: string, init?: RequestInit): Promise<T> {
  const resp = await driveFetch(session, url, init);
  if (!resp.ok) throw new Error(`Drive API error ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

export async function createFolder(session: GoogleSession, name: string, parentId?: string): Promise<string> {
  const metadata: any = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const file = await driveJson<any>(session, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(metadata)
  });
  return file.id;
}

export async function readFileText(session: GoogleSession, fileId: string): Promise<string> {
  const resp = await driveFetch(session, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!resp.ok) throw new Error(`Read file failed ${resp.status}: ${await resp.text()}`);
  return resp.text();
}

export async function resumableUpload(session: GoogleSession, data: Blob, metadata: any, fileIdToUpdate?: string): Promise<string> {
  const endpoint = fileIdToUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileIdToUpdate}?uploadType=resumable`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';

  const start = await driveFetch(session, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': metadata.mimeType || data.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(data.size)
    },
    body: JSON.stringify(metadata)
  });

  if (!start.ok) throw new Error(`Resumable start failed ${start.status}: ${await start.text()}`);
  const uploadUrl = start.headers.get('Location');
  if (!uploadUrl) throw new Error('Missing resumable Location header');

  const put = await driveFetch(session, uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': metadata.mimeType || data.type || 'application/octet-stream',
      'Content-Length': String(data.size)
    },
    body: data
  });

  if (!put.ok) throw new Error(`Resumable upload failed ${put.status}: ${await put.text()}`);
  const uploaded = await put.json();
  return uploaded.id;
}

export async function createJsonFile(session: GoogleSession, name: string, parentId: string, contents: any): Promise<string> {
  const blob = new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' });
  return resumableUpload(session, blob, { name, parents: [parentId], mimeType: 'application/json' });
}

export async function ensureChildFolder(session: GoogleSession, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${name.replaceAll("'","\\'")}'`);
  const res = await driveJson<any>(session, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const existing = res.files?.[0]?.id;
  if (existing) return existing;
  return createFolder(session, name, parentId);
}

export async function ensureFile(session: GoogleSession, parentId: string, name: string, defaultJson: any): Promise<string> {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and name='${name.replaceAll("'","\\'")}'`);
  const res = await driveJson<any>(session, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const existing = res.files?.[0]?.id;
  if (existing) return existing;
  const blob = new Blob([JSON.stringify(defaultJson, null, 2)], {type:'application/json'});
  return resumableUpload(session, blob, { name, parents:[parentId], mimeType:'application/json' });
}

export async function writeJson(session: GoogleSession, fileId: string, obj: any) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  await resumableUpload(session, blob, { name: 'data.json', mimeType:'application/json' }, fileId);
}

export async function loadJson<T>(session: GoogleSession, fileId: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFileText(session, fileId)) as T; } catch { return fallback; }
}

export async function downloadFileBlob(session: GoogleSession, fileId: string): Promise<Blob> {
  const resp = await driveFetch(session, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!resp.ok) throw new Error(`Download failed ${resp.status}: ${await resp.text()}`);
  return resp.blob();
}
