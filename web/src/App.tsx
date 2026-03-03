import React from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import Home from './pages/Home';
import Site from './pages/Site';

export default function App() {
  return (
    <div>
      <header className="row" style={{padding:12,borderBottom:'1px solid #eee',justifyContent:'space-between'}}>
        <div className="row">
          <strong>SLS Drive Inspections</strong>
          <Link to="/" style={{textDecoration:'none'}}>Home</Link>
        </div>
        <div className="small">Master map + quarterly inspections → Google Drive</div>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/site/:siteKey" element={<Site />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
