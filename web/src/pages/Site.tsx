import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ensureFreshToken, type GoogleSession, ensureChildFolder, ensureFile, loadJson, writeJson, resumableUpload, downloadFileBlob, driveJson } from '../lib/google';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Asset, Layer, Result, Status } from '../lib/types';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import ExcelJS from 'exceljs';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const LS_KEY = 'sls_drive_state_v3';

type LocalState = { session?: GoogleSession; };
function loadState(): LocalState { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }

const STATUS_ORDER: Status[] = ['OUT','DIM','FLICKER','DAMAGED','NA','OK'];
const BADGE: Record<Status,string> = { OK:'OK', OUT:'O', DIM:'DI', FLICKER:'F', DAMAGED:'D', NA:'N' };

function nowIso() { return new Date().toISOString(); }

export default function Site() {
  const { siteKey } = useParams();
  const [session, setSession] = useState<GoogleSession|undefined>(() => loadState().session);
  const [msg, setMsg] = useState('');

  const [baseMapsId, setBaseMapsId] = useState('');
  const [dataId, setDataId] = useState('');
  const [inspectionsId, setInspectionsId] = useState('');

  const [layersFileId, setLayersFileId] = useState('');
  const [assetsFileId, setAssetsFileId] = useState('');

  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerName, setActiveLayerName] = useState('');
  const activeLayer = useMemo(() => layers.find(l => l.name === activeLayerName) || null, [layers, activeLayerName]);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const selectedAsset = assets.find(a => a.id === selectedAssetId) || null;

  const [bgUrl, setBgUrl] = useState<string>(''); // dataURL for pdf or objectURL for image
  const [mode, setMode] = useState<'inventory'|'inspection'>('inventory');

  // ---- Inspections ----
  const [inspectionLabel, setInspectionLabel] = useState('2026 Q1');
  const [inspectionFolders, setInspectionFolders] = useState<{id:string; name:string}[]>([]);
  const [inspectionFolderId, setInspectionFolderId] = useState('');
  const [photosFolderId, setPhotosFolderId] = useState('');
  const [resultsFileId, setResultsFileId] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({});
  const photoInputRef = useRef<HTMLInputElement|null>(null);

  function statusFor(assetId: string): Status {
    return (results[assetId]?.status || 'OK') as Status;
  }

  async function refreshInspectionList(sess: GoogleSession, parentInspectionsId: string) {
    const q = encodeURIComponent(`'${parentInspectionsId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`);
    const res = await driveJson<any>(sess, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const list = (res.files || []).map((f:any) => ({ id: f.id, name: String(f.name) })).sort((a:any,b:any)=>a.name.localeCompare(b.name));
    setInspectionFolders(list);
  }

  useEffect(() => {
    (async () => {
      if (!siteKey) return;
      if (!session) return;
      setMsg('Refreshing token…');
      const fresh = await ensureFreshToken(session, CLIENT_ID);
      setSession(fresh);
      localStorage.setItem(LS_KEY, JSON.stringify({ session: fresh }));

      setMsg('Loading site folders…');
      const bm = await ensureChildFolder(fresh, siteKey, 'Base Maps');
      const d = await ensureChildFolder(fresh, siteKey, 'Data');
      const ins = await ensureChildFolder(fresh, siteKey, 'Inspections');
      setBaseMapsId(bm); setDataId(d); setInspectionsId(ins);

      const lf = await ensureFile(fresh, d, 'layers.json', []);
      const af = await ensureFile(fresh, d, 'assets.json', []);
      setLayersFileId(lf); setAssetsFileId(af);

      const ls = await loadJson<Layer[]>(fresh, lf, []);
      setLayers(ls);
      setActiveLayerName(ls[0]?.name || '');
      const as = await loadJson<Asset[]>(fresh, af, []);
      setAssets(as);

      await refreshInspectionList(fresh, ins);

      setMsg('');
    })().catch(e => setMsg(String(e?.message || e)));
  }, [siteKey]);

  useEffect(() => {
    (async () => {
      if (!session || !activeLayer) return;
      setBgUrl('');
      setMsg(activeLayer.type === 'pdf' ? 'Rendering PDF…' : 'Loading image…');
      const blob = await downloadFileBlob(session, activeLayer.fileId);
      if (activeLayer.type === 'image') {
        setBgUrl(URL.createObjectURL(blob));
        setMsg('');
        return;
      }
      const buf = await blob.arrayBuffer();
      const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setBgUrl(canvas.toDataURL('image/png'));
      setMsg('');
    })().catch(e => setMsg(String(e?.message || e)));
  }, [activeLayer?.fileId, session?.accessToken]);

  async function uploadBaseMap(kind: Layer['kind'], type: Layer['type']) {
    if (!session || !baseMapsId) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'pdf' ? 'application/pdf' : 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let layerName = '';
      let driveName = '';
      if (kind === 'EXTERIOR_PLAN') { layerName = 'Exterior Plan'; driveName = 'Exterior Plan.pdf'; }
      if (kind === 'EXTERIOR_AERIAL') { layerName = 'Exterior Aerial'; driveName = `Exterior Aerial.${file.name.split('.').pop() || 'jpg'}`; }
      if (kind === 'INTERIOR_PLAN') { layerName = prompt('Interior layer name') || 'Interior – Floor 1'; driveName = `${layerName}.pdf`; }

      setMsg('Uploading…');
      const fileId = await resumableUpload(session, file, { name: driveName, parents:[baseMapsId], mimeType: file.type || (type==='pdf'?'application/pdf':'image/jpeg') });

      const nextLayers = [...layers];
      const newLayer: Layer = { name: layerName, kind, type, fileId, pageIndex: 0 };
      const idx = nextLayers.findIndex(l => l.name === layerName);
      if (idx >= 0) nextLayers[idx] = newLayer; else nextLayers.push(newLayer);

      await writeJson(session, layersFileId, nextLayers);
      setLayers(nextLayers);
      setActiveLayerName(layerName);
      setMsg('');
    };
    input.click();
  }

  async function addAssetAt(nx:number, ny:number) {
    if (!session || !activeLayer) return;
    const id = crypto.randomUUID();
    const next: Asset = { id, category:'LIGHTING', typeCode:'WP-FC', layerName: activeLayer.name, x:nx, y:ny };
    const nextAssets = [...assets, next];
    setAssets(nextAssets);
    await writeJson(session, assetsFileId, nextAssets);
  }

  async function openInspection(label: string) {
    if (!session || !inspectionsId) return;
    setMsg('Opening inspection…');
    const folder = await ensureChildFolder(session, inspectionsId, label);
    const photos = await ensureChildFolder(session, folder, 'photos');
    const rf = await ensureFile(session, folder, 'results.json', []);
    setInspectionLabel(label);
    setInspectionFolderId(folder);
    setPhotosFolderId(photos);
    setResultsFileId(rf);
    const arr = await loadJson<Result[]>(session, rf, []);
    const map: Record<string, Result> = {};
    for (const r of arr) map[r.assetId] = r;
    setResults(map);
    setMode('inspection');
    setMsg('');
    await refreshInspectionList(session, inspectionsId);
  }

  async function startNewInspection() {
    if (!session || !inspectionsId) return;
    const label = prompt('New inspection label (e.g., 2026 Q2):', inspectionLabel) || '';
    if (!label.trim()) return;
    await openInspection(label.trim());
  }

  async function persistResults(next: Record<string, Result>) {
    if (!session || !resultsFileId) return;
    await writeJson(session, resultsFileId, Object.values(next));
  }

  async function setStatus(s: Status) {
    if (!selectedAsset || mode !== 'inspection') return;
    const current = results[selectedAsset.id];
    const nextR: Result = {
      assetId: selectedAsset.id,
      status: s,
      notes: current?.notes || '',
      photos: current?.photos || [],
      updatedAt: nowIso()
    };
    const next = { ...results, [selectedAsset.id]: nextR };
    setResults(next);
    await persistResults(next);

    if ((s === 'OUT' || s === 'DAMAGED') && (nextR.photos?.length || 0) === 0) {
      if (confirm('Add photo now?')) photoInputRef.current?.click();
    }
    if ((s === 'DIM' || s === 'FLICKER' || s === 'NA') && !(nextR.notes||'').trim()) {
      alert('Note required for DIM/FLICKER/NA.');
    }
  }

  async function saveNote(note: string) {
    if (!selectedAsset || mode !== 'inspection') return;
    const current = results[selectedAsset.id] || { assetId: selectedAsset.id, status: 'OK', updatedAt: nowIso() } as Result;
    const nextR = { ...current, notes: note, updatedAt: nowIso() };
    const next = { ...results, [selectedAsset.id]: nextR };
    setResults(next);
    await persistResults(next);
  }

  async function uploadPhoto(file: File) {
    if (!session || !selectedAsset || !photosFolderId) return;
    setMsg('Uploading photo…');
    const name = `${selectedAsset.id}_${Date.now()}_${file.name}`;
    const fileId = await resumableUpload(session, file, { name, parents:[photosFolderId], mimeType: file.type || 'image/jpeg' });
    setMsg('');

    const current = results[selectedAsset.id] || { assetId: selectedAsset.id, status: 'OK', updatedAt: nowIso() } as Result;
    const photos = [...(current.photos||[]), { fileId, name }];
    const nextR = { ...current, photos, updatedAt: nowIso() };
    const next = { ...results, [selectedAsset.id]: nextR };
    setResults(next);
    await persistResults(next);
  }

  async function generatePdfBlob(): Promise<Blob> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const cover = pdfDoc.addPage([612, 792]);
    cover.drawText('Site Lighting Inspection Report', { x: 50, y: 740, size: 20, font: fontB });
    cover.drawText(`Inspection: ${inspectionLabel}`, { x: 50, y: 710, size: 12, font });
    cover.drawText(`Generated: ${new Date().toLocaleString()}`, { x: 50, y: 690, size: 12, font });

    let y = 650;
    cover.drawText('Summary:', { x: 50, y, size: 12, font: fontB });
    y -= 18;
    const counts: Record<Status, number> = { OK:0, OUT:0, DIM:0, FLICKER:0, DAMAGED:0, NA:0 };
    for (const a of assets) counts[statusFor(a.id)] += 1;
    for (const s of STATUS_ORDER) {
      cover.drawText(`${s}: ${counts[s]}`, { x: 70, y, size: 12, font });
      y -= 16;
    }

    for (const layer of layers) {
      const layerAssets = assets.filter(a => a.layerName === layer.name);
      if (layerAssets.length === 0) continue;
      const p = pdfDoc.addPage([612, 792]);
      p.drawText(`${layer.name} — Table`, { x: 50, y: 740, size: 14, font: fontB });
      let ty = 710;
      p.drawText('Asset', { x: 50, y: ty, size: 10, font: fontB });
      p.drawText('Type', { x: 170, y: ty, size: 10, font: fontB });
      p.drawText('Status', { x: 280, y: ty, size: 10, font: fontB });
      p.drawText('Notes', { x: 360, y: ty, size: 10, font: fontB });
      ty -= 16;

      const sorted = [...layerAssets].sort((a,b) => {
        const sa = STATUS_ORDER.indexOf(statusFor(a.id));
        const sb = STATUS_ORDER.indexOf(statusFor(b.id));
        if (sa !== sb) return sa - sb;
        return a.typeCode.localeCompare(b.typeCode);
      });

      for (const a of sorted) {
        if (ty < 60) break;
        const st = statusFor(a.id);
        const note = (results[a.id]?.notes || '').replace(/\s+/g,' ').slice(0, 80);
        p.drawText(a.id.slice(0,8), { x: 50, y: ty, size: 9, font });
        p.drawText(a.typeCode, { x: 170, y: ty, size: 9, font });
        p.drawText(`${st} (${BADGE[st]})`, { x: 280, y: ty, size: 9, font });
        p.drawText(note, { x: 360, y: ty, size: 9, font });
        ty -= 14;
      }
    }

    const bytes = await pdfDoc.save();
    return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  }

  async function generateExcelBlob(): Promise<Blob> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Results');
    ws.columns = [
      { header: 'Layer', key: 'layer', width: 22 },
      { header: 'Asset ID', key: 'id', width: 36 },
      { header: 'Category', key: 'cat', width: 12 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Notes', key: 'notes', width: 40 },
      { header: 'X', key: 'x', width: 8 },
      { header: 'Y', key: 'y', width: 8 }
    ];
    for (const a of assets) {
      ws.addRow({
        layer: a.layerName,
        id: a.id,
        cat: a.category,
        type: a.typeCode,
        status: statusFor(a.id),
        notes: results[a.id]?.notes || '',
        x: a.x,
        y: a.y
      });
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function uploadReport() {
    if (!session || !inspectionFolderId) return;
    setMsg('Generating report…');
    const pdf = await generatePdfBlob();
    const xlsx = await generateExcelBlob();
    setMsg('Uploading report to Drive…');
    await resumableUpload(session, pdf, { name: 'report.pdf', parents:[inspectionFolderId], mimeType:'application/pdf' });
    await resumableUpload(session, xlsx, { name: 'report.xlsx', parents:[inspectionFolderId], mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    setMsg('Report uploaded.');
    alert('Report uploaded to Drive under this inspection folder.');
  }

  function onBackgroundClick(e: React.MouseEvent<HTMLImageElement>) {
    if (mode !== 'inventory') return; // inventory locked during inspection
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    addAssetAt(nx, ny).catch(err=>setMsg(String(err?.message||err)));
  }

  const layerAssets = assets.filter(a => a.layerName === activeLayerName);

  if (!siteKey) return <div style={{padding:16}}>Missing site id.</div>;
  if (!session) return <div style={{padding:16}}>Go back to Home and sign in.</div>;

  return (
    <div style={{padding:16, display:'grid', gap:12}}>
      <div className="card">
        <div className="row" style={{justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:700}}>Site Workspace</div>
            <div className="small">
              Master map: <code>Data/assets.json</code> • Inspections: <code>Inspections/&lt;label&gt;/</code>
            </div>
          </div>
          <div className="row">
            <button className={mode==='inventory'?'btn primary':'btn'} onClick={()=>setMode('inventory')}>Inventory (edit master)</button>
            <button className={mode==='inspection'?'btn primary':'btn'} onClick={()=>setMode('inspection')}>Inspection (locked)</button>
            <button className="btn" onClick={()=>uploadBaseMap('EXTERIOR_PLAN','pdf')}>Upload Exterior Plan</button>
            <button className="btn" onClick={()=>uploadBaseMap('EXTERIOR_AERIAL','image')}>Upload Exterior Aerial</button>
            <button className="btn" onClick={()=>uploadBaseMap('INTERIOR_PLAN','pdf')}>Upload Interior Plan</button>
          </div>
        </div>

        {mode==='inspection' && (
          <div className="row" style={{marginTop:10}}>
            <button className="btn primary" onClick={startNewInspection}>Start New Inspection (creates folder)</button>
            <label className="small">Open:&nbsp;
              <select value={inspectionLabel} onChange={e=>openInspection(e.target.value)}>
                <option value="" disabled>Select inspection</option>
                {inspectionFolders.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
              </select>
            </label>
            <button className="btn" onClick={uploadReport} disabled={!inspectionFolderId}>Generate + Upload Report</button>
            <span className="small">Current: <span className="badge">{inspectionLabel || 'None'}</span></span>
          </div>
        )}

        {msg && <div className="small" style={{marginTop:8}}>{msg}</div>}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="row" style={{justifyContent:'space-between'}}>
            <div className="row">
              <label className="small">Layer:&nbsp;
                <select value={activeLayerName} onChange={e=>setActiveLayerName(e.target.value)}>
                  <option value="" disabled>Select layer</option>
                  {layers.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </label>
              <span className="small">{mode==='inventory' ? 'Click background to place (master map).' : 'Click marker to inspect (master locked).'}</span>
            </div>
            <div className="small">Assets: {layerAssets.length}</div>
          </div>

          <div style={{height:'70vh', border:'1px solid #eee', borderRadius:12, overflow:'hidden', marginTop:10}}>
            {activeLayer && bgUrl && (
              <TransformWrapper minScale={0.3} maxScale={5} initialScale={1}>
                <TransformComponent>
                  <div style={{position:'relative', display:'inline-block'}}>
                    <img src={bgUrl} alt="layer" style={{display:'block'}} onClick={onBackgroundClick} />
                    {layerAssets.map(a => {
                      const st = mode==='inspection' ? statusFor(a.id) : 'OK';
                      const ring = st === 'OK' ? '#111' : '#b00020';
                      return (
                        <button
                          key={a.id}
                          onClick={(ev)=>{ev.stopPropagation(); setSelectedAssetId(a.id);}}
                          title={`${a.typeCode} • ${st}`}
                          style={{
                            position:'absolute',
                            left:`${a.x*100}%`,
                            top:`${a.y*100}%`,
                            transform:'translate(-50%,-50%)',
                            width:22,height:22,borderRadius:999,
                            border:`3px solid ${ring}`,
                            background:'#fff',
                            cursor:'pointer'
                          }}
                        >
                          <span style={{fontSize:10, fontWeight:700}}>{mode==='inspection' ? BADGE[st as Status] : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                </TransformComponent>
              </TransformWrapper>
            )}
            {!activeLayer && <div className="small" style={{padding:12}}>Upload base maps and select a layer.</div>}
          </div>
        </div>

        <div className="card">
          <h3 style={{marginTop:0}}>Asset Details</h3>
          {!selectedAsset ? (
            <div className="small">Click a marker to view/edit.</div>
          ) : (
            <div style={{display:'grid', gap:10}}>
              <div className="small"><strong>ID:</strong> {selectedAsset.id}</div>
              <div className="row">
                <span className="badge">{selectedAsset.category}</span>
                <span className="badge">{selectedAsset.typeCode}</span>
                <span className="badge">{selectedAsset.layerName}</span>
              </div>

              {mode === 'inspection' ? (
                <>
                  <div className="small"><strong>Status:</strong> {results[selectedAsset.id]?.status || 'OK'}</div>
                  <div className="row">
                    {(['OK','OUT','DIM','FLICKER','DAMAGED','NA'] as Status[]).map(s => (
                      <button key={s} className={s === (results[selectedAsset.id]?.status||'OK') ? 'btn primary' : 'btn'} onClick={()=>setStatus(s)}>
                        {s}
                      </button>
                    ))}
                  </div>

                  <label className="small">Notes</label>
                  <textarea value={results[selectedAsset.id]?.notes || ''} onChange={e=>saveNote(e.target.value)} />

                  <div className="row">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{display:'none'}}
                      onChange={(e)=>{
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(f).catch(err=>setMsg(String(err?.message||err)));
                        e.currentTarget.value = '';
                      }}
                    />
                    <button className="btn" onClick={()=>photoInputRef.current?.click()} disabled={!photosFolderId}>Add Photo</button>
                    <span className="small">Photos: {(results[selectedAsset.id]?.photos?.length || 0)}</span>
                  </div>
                </>
              ) : (
                <div className="small">Switch to Inspection mode to set status/notes/photos.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
