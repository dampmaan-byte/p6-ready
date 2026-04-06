"use client";
// @ts-nocheck

import { useState, useMemo, useCallback, useRef } from "react";

// ─── STOCK INVENTORY (nominal sizes) ─────────────────────────────────────────
const STOCK = {
  1: [
    [16,20],[20,20],[20,25],[16,25],[24,24],[14,20],[20,24],[15,20],[12,24],
    [16,24],[14,25],[10,20],[25,25],[18,25],[16,16],[18,20],[22,22],
    [10,24],[10,25],[12,25],[15,25],[14,24],[18,24],[20,30]
  ],
  2: [
    [16,20],[20,20],[20,25],[16,25],[24,24],[12,24],[20,24],[18,24],[18,25],
    [14,20],[14,25],[16,24],[25,25],[15,20],[10,20],[16,16],[12,20],[18,20],
    [15,25],[16,30],[20,22],[12,25],[18,18],[20,30]
  ],
  4: [
    [24,24],[12,24],[20,20],[16,20],[16,25],[20,25],[20,24],[18,24],[16,24]
  ]
};

const PRODUCTS = [
  { id: "aeropleat3",  label: "Camfil Aeropleat III",  short: "Aeropleat III",  merv: 8,  drawing: "116306" },
  { id: "3030",        label: "Camfil 30/30",           short: "30/30",          merv: 8,  drawing: "068766" },
  { id: "aeropleat13", label: "Camfil Aeropleat 13",    short: "Aeropleat 13",   merv: 13, drawing: "—"      },
  { id: "mv8",         label: "Mann Hummel MV8",        short: "MV8",            merv: 8,  drawing: "—"      },
];

const DEPTH_ACTUAL = { 1: 0.88, 2: 1.75, 4: 3.75 };
const toActual = (nom) => nom - 0.5;
const toActualDepth = (d) => DEPTH_ACTUAL[d];

const PREFERRED = new Set(["16x20","20x20","20x25","16x25","24x24","20x24","12x24","20x30","25x25"]);
const isPreferred = (nomH, nomW) => PREFERRED.has(`${nomH}x${nomW}`) || PREFERRED.has(`${nomW}x${nomH}`);

const cutMethodLabel = (r) => {
  if (r.multiYield) {
    const dir = r.splitDirection === "height" ? "2×1" : "1×2";
    if (r.stockFilters.length === 1) return `Multi-Yield ${dir}`;
    return `Multi-Yield ${dir} — ${r.stockFilters.length}-Filter Butt`;
  }
  if (r.type === "single") return "Single Cut";
  if (r.layout === "grid") return `${r.gridRows}×${r.gridCols} Grid`;
  return `${r.stockFilters.length}-Filter Butt`;
};

const stockPullLabel = (r, qty) => {
  const yieldsPerStock = r.yieldsPerStock || 1;
  const sets = Math.ceil(qty / yieldsPerStock);
  const totalStock = sets * r.stockFilters.length;
  if (yieldsPerStock > 1) return `pull ${totalStock} → makes ${sets * yieldsPerStock}`;
  return `${totalStock} stock`;
};

// ─── CUTTING ENGINE ───────────────────────────────────────────────────────────
function getStockOrientations(stocks) {
  const orientations = [];
  const seen = new Set();
  for (const [sH, sW] of stocks) {
    const key1 = `${sH},${sW}`;
    if (!seen.has(key1)) { seen.add(key1); orientations.push({ nomH: sH, nomW: sW, actH: toActual(sH), actW: toActual(sW), rotated: false }); }
    if (sH !== sW) {
      const key2 = `${sW},${sH}`;
      if (!seen.has(key2)) { seen.add(key2); orientations.push({ nomH: sW, nomW: sH, actH: toActual(sW), actW: toActual(sH), rotated: true, origNomH: sH, origNomW: sW }); }
    }
  }
  return orientations;
}

function findBestCut(customH, customW, depth, qty) {
  const stocks = STOCK[depth];
  if (!stocks) return null;
  const needH = customH, needW = customW;
  const results = [];
  const allOrientations = getStockOrientations(stocks);
  const MIN_CUT = 1;
  const isSafeCut = (trim) => trim === 0 || trim >= MIN_CUT;

  for (const f of allOrientations) {
    if (f.actH >= needH && f.actW >= needW) {
      const wasteH = +(f.actH - needH).toFixed(4), wasteW = +(f.actW - needW).toFixed(4);
      if (!isSafeCut(wasteH) || !isSafeCut(wasteW)) continue;
      const wasteArea = +((f.actH * f.actW) - (needH * needW)).toFixed(4);
      const cuts = (wasteH > 0 ? 1 : 0) + (wasteW > 0 ? 1 : 0);
      results.push({ type:"single", stockFilters:[{ nomH:f.nomH, nomW:f.nomW, actH:f.actH, actW:f.actW, rotated:f.rotated, origNomH:f.origNomH, origNomW:f.origNomW }], trimH:wasteH, trimW:wasteW, wasteArea, cuts, customActH:needH, customActW:needW, depth });
    }
  }

  const byActH = {};
  for (const f of allOrientations) { const hKey = f.actH.toFixed(2); if (!byActH[hKey]) byActH[hKey]=[]; byActH[hKey].push(f); }

  const addLinearResult = (actH, filterCombo) => {
    const combinedW = filterCombo.reduce((sum, f) => sum + f.actW, 0);
    if (combinedW < needW) return;
    const wasteH = +(actH - needH).toFixed(4), wasteW = +(combinedW - needW).toFixed(4);
    if (!isSafeCut(wasteH) || !isSafeCut(wasteW)) return;
    const wasteArea = +((actH * combinedW) - (needH * needW)).toFixed(4);
    const joints = filterCombo.length - 1;
    const cuts = joints + (wasteH > 0 ? 1 : 0) + (wasteW > 0 ? 1 : 0);
    const count = filterCombo.length;
    results.push({ type: count===2?"linear-2":count===3?"linear-3":"linear-4", layout:"linear", gridRows:1, gridCols:count, stockFilters:filterCombo.map(f=>({ nomH:f.nomH, nomW:f.nomW, actH:f.actH, actW:f.actW, rotated:f.rotated, origNomH:f.origNomH, origNomW:f.origNomW })), trimH:wasteH, trimW:wasteW, combinedW, combinedH:actH, wasteArea, cuts, customActH:needH, customActW:needW, depth });
  };

  for (const [hKey, filters] of Object.entries(byActH)) {
    const actH = parseFloat(hKey);
    if (actH < needH) continue;
    for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) addLinearResult(actH,[filters[i],filters[j]]);
    for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) addLinearResult(actH,[filters[i],filters[j],filters[k]]);
    for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) for (let l=k;l<filters.length;l++) addLinearResult(actH,[filters[i],filters[j],filters[k],filters[l]]);
  }

  const uniqueHeights = [...new Set(allOrientations.map(f => +f.actH.toFixed(2)))].sort((a,b)=>a-b);
  const uniqueWidths  = [...new Set(allOrientations.map(f => +f.actW.toFixed(2)))].sort((a,b)=>a-b);
  // Fast O(1) filter lookup via hash map
  const filterMap = new Map();
  for (const f of allOrientations) filterMap.set(f.actH.toFixed(2)+'|'+f.actW.toFixed(2), f);
  const findFilter = (h, w) => filterMap.get(h.toFixed(2)+'|'+w.toFixed(2));

  const addGridResult = (rowHeights, colWidths) => {
    const nRows=rowHeights.length, nCols=colWidths.length;
    const combinedH=rowHeights.reduce((a,b)=>a+b,0), combinedW=colWidths.reduce((a,b)=>a+b,0);
    if (combinedH<needH||combinedW<needW) return;
    const wasteH=+(combinedH-needH).toFixed(4), wasteW=+(combinedW-needW).toFixed(4);
    if (!isSafeCut(wasteH)||!isSafeCut(wasteW)) return;
    const gridFilters=[];
    for (let r=0;r<nRows;r++) for (let c=0;c<nCols;c++) { const f=findFilter(rowHeights[r],colWidths[c]); if (!f) return; gridFilters.push({ nomH:f.nomH, nomW:f.nomW, actH:f.actH, actW:f.actW, rotated:f.rotated, origNomH:f.origNomH, origNomW:f.origNomW, gridRow:r, gridCol:c }); }
    const wasteArea=+((combinedH*combinedW)-(needH*needW)).toFixed(4);
    const joints=(nRows-1)+(nCols-1), cuts=joints+(wasteH>0?1:0)+(wasteW>0?1:0);
    results.push({ type:`grid-${nRows}x${nCols}`, layout:"grid", gridRows:nRows, gridCols:nCols, rowHeights, colWidths, stockFilters:gridFilters, trimH:wasteH, trimW:wasteW, combinedW, combinedH, wasteArea, cuts, customActH:needH, customActW:needW, depth });
  };

  // N-element combinations with repetition (sorted, deduped by starting index)
  const combos = (arr, n) => {
    if (n===1) return arr.map(x=>[x]);
    if (n===2) return arr.flatMap((x,i)=>arr.slice(i).map(y=>[x,y]));
    if (n===3) return arr.flatMap((x,i)=>arr.slice(i).flatMap((y,j)=>arr.slice(i+j).map(z=>[x,y,z])));
    if (n===4) return arr.flatMap((x,i)=>arr.slice(i).flatMap((y,j)=>arr.slice(i+j).flatMap((z,k)=>arr.slice(i+j+k).map(w=>[x,y,z,w]))));
    return [];
  };

  // Mixed-size grids: full combo search (up to 3×3, plus 2×4, 4×2)
  const smallGridConfigs=[[2,2],[2,3],[3,2],[3,3],[2,4],[4,2]];
  for (const [nRows,nCols] of smallGridConfigs) {
    const hCombos=combos(uniqueHeights,nRows), wCombos=combos(uniqueWidths,nCols);
    for (const rh of hCombos) { const totalH=rh.reduce((a,b)=>a+b,0); if(totalH<needH) continue; for (const cw of wCombos) { const totalW=cw.reduce((a,b)=>a+b,0); if(totalW<needW) continue; addGridResult(rh,cw); } }
  }

  // Large grids (3×4, 4×3, 4×4): same-height-per-row, same-width-per-col only (for performance)
  const largeGridConfigs=[[3,4],[4,3],[4,4]];
  for (const [nRows,nCols] of largeGridConfigs) {
    for (const h of uniqueHeights) { const totalH=h*nRows; if(totalH<needH) continue;
      for (const w of uniqueWidths) { const totalW=w*nCols; if(totalW<needW) continue;
        addGridResult(Array(nRows).fill(h), Array(nCols).fill(w)); } }
  }

  // ─── MULTI-YIELD: 2 custom filters from 1 stock arrangement ───
  if ((qty || 1) > 1) {
    const addMultiYield = (filterCombo, combinedH, combinedW, extraJoints) => {
      const mapF = f => ({ nomH:f.nomH, nomW:f.nomW, actH:f.actH, actW:f.actW, rotated:f.rotated, origNomH:f.origNomH, origNomW:f.origNomW });
      const joints = extraJoints != null ? extraJoints : filterCombo.length - 1;
      // 2×1: two customs stacked in height direction
      if (combinedH >= needH * 2) {
        const midWaste = +(combinedH - needH * 2).toFixed(4);
        const trimW = +(combinedW - needW).toFixed(4);
        if (combinedW >= needW && isSafeCut(midWaste) && isSafeCut(trimW)) {
          const wasteArea = +((combinedH * combinedW) - (needH * needW * 2)).toFixed(4);
          const cuts = 1 + joints + (midWaste > 0 ? 1 : 0) + (trimW > 0 ? 1 : 0);
          results.push({ type:"multi-2x1", multiYield:true, yieldsPerStock:2, splitDirection:"height",
            layout: filterCombo.length > 1 ? "linear" : undefined,
            stockFilters: filterCombo.map(mapF), trimH:midWaste, trimW, combinedW, combinedH,
            wasteArea, cuts, customActH:needH, customActW:needW, depth });
        }
      }
      // 1×2: two customs side by side in width direction
      if (combinedH >= needH && combinedW >= needW * 2) {
        const trimH = +(combinedH - needH).toFixed(4);
        const midWaste = +(combinedW - needW * 2).toFixed(4);
        if (isSafeCut(trimH) && isSafeCut(midWaste)) {
          const wasteArea = +((combinedH * combinedW) - (needH * needW * 2)).toFixed(4);
          const cuts = 1 + joints + (trimH > 0 ? 1 : 0) + (midWaste > 0 ? 1 : 0);
          results.push({ type:"multi-1x2", multiYield:true, yieldsPerStock:2, splitDirection:"width",
            layout: filterCombo.length > 1 ? "linear" : undefined,
            stockFilters: filterCombo.map(mapF), trimH, trimW:midWaste, combinedW, combinedH,
            wasteArea, cuts, customActH:needH, customActW:needW, depth });
        }
      }
    };
    // Single stock multi-yield
    for (const f of allOrientations) addMultiYield([f], f.actH, f.actW);
    // Linear butt multi-yield (2, 3, 4 filters)
    for (const [hKey, filters] of Object.entries(byActH)) {
      const actH = parseFloat(hKey);
      const tryCombo = (combo) => addMultiYield(combo, actH, combo.reduce((s,f)=>s+f.actW,0));
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) tryCombo([filters[i],filters[j]]);
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) tryCombo([filters[i],filters[j],filters[k]]);
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) for (let l=k;l<filters.length;l++) tryCombo([filters[i],filters[j],filters[k],filters[l]]);
    }
    // Grid multi-yield (2×2 through 4×4 stock grids → 2 custom filters)
    const addGridMultiYield = (rowHeights, colWidths) => {
      const nRows=rowHeights.length, nCols=colWidths.length;
      const combinedH=rowHeights.reduce((a,b)=>a+b,0), combinedW=colWidths.reduce((a,b)=>a+b,0);
      const gridFilters=[];
      for (let r=0;r<nRows;r++) for (let c=0;c<nCols;c++) { const f=findFilter(rowHeights[r],colWidths[c]); if(!f) return; gridFilters.push(f); }
      const gridJoints = (nRows-1)+(nCols-1);
      addMultiYield(gridFilters, combinedH, combinedW, gridJoints);
    };
    for (const [nRows,nCols] of smallGridConfigs) {
      const hCombos=combos(uniqueHeights,nRows), wCombos=combos(uniqueWidths,nCols);
      for (const rh of hCombos) { const totalH=rh.reduce((a,b)=>a+b,0); if(totalH<needH*2&&totalH<needH) continue;
        for (const cw of wCombos) { const totalW=cw.reduce((a,b)=>a+b,0); if(totalW<needW*2&&totalW<needW) continue;
          addGridMultiYield(rh,cw); } }
    }
    for (const [nRows,nCols] of largeGridConfigs) {
      for (const h of uniqueHeights) { const totalH=h*nRows; if(totalH<needH*2&&totalH<needH) continue;
        for (const w of uniqueWidths) { const totalW=w*nCols; if(totalW<needW*2&&totalW<needW) continue;
          addGridMultiYield(Array(nRows).fill(h),Array(nCols).fill(w)); } }
    }
  }

  const tierScore=(r)=>{
    const allPref=r.stockFilters.every(f=>isPreferred(f.nomH,f.nomW));
    const somePref=r.stockFilters.some(f=>isPreferred(f.nomH,f.nomW));
    const allSame=r.stockFilters.every(f=>f.nomH===r.stockFilters[0].nomH&&f.nomW===r.stockFilters[0].nomW);
    if(r.multiYield&&allPref&&allSame) return -3;
    if(r.multiYield&&allPref) return -2;
    if(r.multiYield) return -1;
    if(allPref&&allSame&&r.stockFilters.length>1) return 0;
    if(r.type==="single"&&allPref) return 1;
    if(allPref) return 2;
    if(r.type==="single") return 3;
    if(somePref) return 4;
    return 5;
  };
  results.sort((a,b)=>tierScore(a)-tierScore(b)||a.stockFilters.length-b.stockFilters.length||a.wasteArea-b.wasteArea||a.cuts-b.cuts);
  return results.length>0?results.slice(0,12):null;
}

// ─── SVG CUT DIAGRAM ─────────────────────────────────────────────────────────
function CutDiagram({ result, compact = false, printMode = false }) {
  const svgW = compact ? 320 : 420;
  const svgH = compact ? 220 : 300;
  const pad = compact ? 40 : 55;
  const drawW = svgW - pad * 2;
  const drawH = svgH - pad * 2;
  const P = printMode;
  const svgBg        = P ? "#fff"     : "transparent";
  const stockFill    = P ? "#e8e8e8"  : "#1e293b";
  const stockStroke  = P ? "#111"     : "#475569";
  const keepFill     = P ? "#ddd"     : "#059669";
  const keepFillOp   = P ? 0.9        : 0.3;
  const keepStroke   = P ? "#111"     : "#10b981";
  const wasteFill    = P ? "#fff"     : "#dc2626";
  const wasteFillOp  = P ? 0          : 0.15;
  const wasteStroke  = P ? "#555"     : "#ef4444";
  const dimStroke    = P ? "#111"     : "#10b981";
  const dimFill      = P ? "#111"     : "#10b981";
  const stkDimStroke = P ? "#555"     : "#94a3b8";
  const stkDimFill   = P ? "#555"     : "#94a3b8";
  const keepTextFill = P ? "#000"     : "#10b981";
  const wasteTextFill= P ? "#444"     : "#ef4444";
  const jointStroke  = P ? "#333"     : "#f59e0b";
  const jointTextFill= P ? "#333"     : "#f59e0b";
  const filterColors = P
    ? ["#bbb","#999","#777","#555","#888","#aaa"]
    : ["#475569","#6366f1","#8b5cf6","#ec4899","#14b8a6","#f97316"];
  const labelColors  = P
    ? ["#222","#333","#444","#555","#666","#777"]
    : ["#94a3b8","#a5b4fc","#c4b5fd","#f9a8d4","#5eead4","#fdba74"];
  const fontSize = compact ? 9 : 11;

  if (result.type === "single") {
    const f = result.stockFilters[0];
    const scale = Math.min(drawW / f.actW, drawH / f.actH);
    const rw = f.actW * scale, rh = f.actH * scale;
    const ox = (svgW - rw) / 2, oy = (svgH - rh) / 2;
    const cw = result.customActW * scale, ch = result.customActH * scale;
    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
        <rect x={ox} y={oy} width={rw} height={rh} fill={stockFill} stroke={stockStroke} strokeWidth={1.5} rx={2}/>
        <rect x={ox} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
        {result.trimW>0&&<rect x={ox+cw} y={oy} width={rw-cw} height={ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
        {result.trimH>0&&<rect x={ox} y={oy+ch} width={rw} height={rh-ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
        <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
        <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
        <line x1={ox} y1={oy-24} x2={ox+rw} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/>
        <text x={ox+rw/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{f.actW}" stk</text>
        <line x1={ox-10} y1={oy} x2={ox-10} y2={oy+ch} stroke={dimStroke} strokeWidth={1}/>
        <text x={ox-14} y={oy+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
        <line x1={ox+rw+10} y1={oy} x2={ox+rw+10} y2={oy+rh} stroke={stkDimStroke} strokeWidth={1}/>
        <text x={ox+rw+14} y={oy+rh/2} textAnchor="start" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace" dominantBaseline="middle">{f.actH}"</text>
        <text x={ox+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?11:13} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP</text>
        {result.trimW>0&&<text x={ox+cw+(rw-cw)/2} y={oy+ch/2} textAnchor="middle" fill={wasteTextFill} fontSize={8} fontFamily="monospace" dominantBaseline="middle">{result.trimW}" waste</text>}
        {result.trimH>0&&<text x={ox+rw/2} y={oy+ch+(rh-ch)/2} textAnchor="middle" fill={wasteTextFill} fontSize={8} fontFamily="monospace" dominantBaseline="middle">{result.trimH}" waste</text>}
      </svg>
    );
  }

  if (result.layout === "grid") {
    const { rowHeights, colWidths, gridRows, gridCols } = result;
    const totalH=rowHeights.reduce((a,b)=>a+b,0), totalW=colWidths.reduce((a,b)=>a+b,0);
    const scale=Math.min(drawW/totalW, drawH/totalH);
    const scaledColW=colWidths.map(w=>w*scale), scaledRowH=rowHeights.map(h=>h*scale);
    const totalRW=scaledColW.reduce((a,b)=>a+b,0), totalRH=scaledRowH.reduce((a,b)=>a+b,0);
    const ox=(svgW-totalRW)/2, oy=(svgH-totalRH)/2;
    const cw=result.customActW*scale, ch=result.customActH*scale;
    const xPos=[]; let cx=ox; for(const w of scaledColW){xPos.push(cx);cx+=w;}
    const yPos=[]; let cy=oy; for(const h of scaledRowH){yPos.push(cy);cy+=h;}
    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
        {result.stockFilters.map((f,i)=><rect key={i} x={xPos[f.gridCol]} y={yPos[f.gridRow]} width={scaledColW[f.gridCol]} height={scaledRowH[f.gridRow]} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
        <rect x={ox} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
        {xPos.slice(1).map((xp,i)=><line key={`v${i}`} x1={xp} y1={oy} x2={xp} y2={oy+totalRH} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/>)}
        {yPos.slice(1).map((yp,i)=><line key={`h${i}`} x1={ox} y1={yp} x2={ox+totalRW} y2={yp} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/>)}
        {result.trimW>0&&<rect x={ox+cw} y={oy} width={totalRW-cw} height={ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
        {result.trimH>0&&<rect x={ox} y={oy+ch} width={totalRW} height={totalRH-ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
        {result.stockFilters.map((f,i)=><text key={i} x={xPos[f.gridCol]+scaledColW[f.gridCol]/2} y={yPos[f.gridRow]+scaledRowH[f.gridRow]/2} textAnchor="middle" dominantBaseline="middle" fill={labelColors[i%labelColors.length]} fontSize={Math.max(7,Math.min(9,60/Math.max(gridRows,gridCols)))} fontFamily="monospace">{String.fromCharCode(65+i)}: {f.nomH}x{f.nomW}</text>)}
        <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
        <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
        <line x1={ox-10} y1={oy} x2={ox-10} y2={oy+ch} stroke={dimStroke} strokeWidth={1}/>
        <text x={ox-14} y={oy+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
        <text x={ox+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?10:12} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP</text>
      </svg>
    );
  }

  // Multi-yield diagram
  if (result.multiYield) {
    const filters = result.stockFilters;
    const totalStockW = filters.length > 1 ? filters.reduce((s,f)=>s+f.actW,0) : filters[0].actW;
    const totalStockH = filters[0].actH;
    const scale = Math.min(drawW / totalStockW, drawH / totalStockH);
    const rw = totalStockW * scale, rh = totalStockH * scale;
    const ox = (svgW - rw) / 2, oy = (svgH - rh) / 2;
    const cw = result.customActW * scale, ch = result.customActH * scale;

    if (result.splitDirection === "height") {
      // 2×1: two customs stacked vertically, waste strip in middle
      const midW = result.trimH * scale; // trimH = middle waste in height direction
      const keep1Y = oy;
      const wasteY = oy + ch;
      const keep2Y = oy + ch + midW;
      // Stock filter outlines
      const scaledWidths = filters.map(f => f.actW * scale);
      const xPositions = []; let lx = ox; for (const sw of scaledWidths) { xPositions.push(lx); lx += sw; }
      return (
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
          {filters.map((f,i)=><rect key={i} x={xPositions[i]} y={oy} width={scaledWidths[i]} height={rh} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
          {/* Top KEEP */}
          <rect x={ox} y={keep1Y} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={ox+cw/2} y={keep1Y+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 1</text>
          {/* Middle waste strip */}
          {midW > 0 && <rect x={ox} y={wasteY} width={rw} height={midW} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {midW > 0 && <text x={ox+rw/2} y={wasteY+midW/2} textAnchor="middle" fill={wasteTextFill} fontSize={7} fontFamily="monospace" dominantBaseline="middle">{result.trimH}" waste</text>}
          {/* Bottom KEEP */}
          <rect x={ox} y={keep2Y} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={ox+cw/2} y={keep2Y+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 2</text>
          {/* Side waste */}
          {result.trimW > 0 && <rect x={ox+cw} y={oy} width={rw-cw} height={rh} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {result.trimW > 0 && <text x={ox+cw+(rw-cw)/2} y={oy+rh/2} textAnchor="middle" fill={wasteTextFill} fontSize={7} fontFamily="monospace" dominantBaseline="middle">{result.trimW}"</text>}
          {/* Butt joints */}
          {xPositions.slice(1).map((xp,i)=><g key={i}><line x1={xp} y1={oy} x2={xp} y2={oy+rh} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/><text x={xp} y={oy+rh+12} textAnchor="middle" fill={jointTextFill} fontSize={7} fontFamily="monospace">joint</text></g>)}
          {/* Dimensions */}
          <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
          {filters.length > 1 && <><line x1={ox} y1={oy-24} x2={ox+rw} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/>
          <text x={ox+rw/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{totalStockW.toFixed(2)}" combined</text></>}
          <line x1={ox-10} y1={keep1Y} x2={ox-10} y2={keep1Y+ch} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox-14} y={keep1Y+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
          <line x1={ox+rw+10} y1={oy} x2={ox+rw+10} y2={oy+rh} stroke={stkDimStroke} strokeWidth={1}/>
          <text x={ox+rw+14} y={oy+rh/2} textAnchor="start" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace" dominantBaseline="middle">{totalStockH}" stk</text>
          {/* Stock filter labels */}
          {filters.map((f,i)=><text key={i} x={xPositions[i]+scaledWidths[i]/2} y={oy+rh+24} textAnchor="middle" fill={labelColors[i%labelColors.length]} fontSize={Math.min(9,100/filters.length)} fontFamily="monospace">{String.fromCharCode(65+i)}: {f.nomH}x{f.nomW}</text>)}
        </svg>
      );
    } else {
      // 1×2: two customs side by side, waste strip in middle
      const midW = result.trimW * scale; // trimW = middle waste in width direction
      const keep1X = ox;
      const wasteX = ox + cw;
      const keep2X = ox + cw + midW;
      const scaledWidths = filters.map(f => f.actW * scale);
      const xPositions = []; let lx = ox; for (const sw of scaledWidths) { xPositions.push(lx); lx += sw; }
      return (
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
          {filters.map((f,i)=><rect key={i} x={xPositions[i]} y={oy} width={scaledWidths[i]} height={rh} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
          {/* Left KEEP */}
          <rect x={keep1X} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={keep1X+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 1</text>
          {/* Middle waste strip */}
          {midW > 0 && <rect x={wasteX} y={oy} width={midW} height={rh} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {midW > 0 && <text x={wasteX+midW/2} y={oy+rh/2} textAnchor="middle" fill={wasteTextFill} fontSize={7} fontFamily="monospace" dominantBaseline="middle">{result.trimW}"</text>}
          {/* Right KEEP */}
          <rect x={keep2X} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={keep2X+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 2</text>
          {/* Top/bottom waste */}
          {result.trimH > 0 && <rect x={ox} y={oy+ch} width={rw} height={rh-ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {result.trimH > 0 && <text x={ox+rw/2} y={oy+ch+(rh-ch)/2} textAnchor="middle" fill={wasteTextFill} fontSize={7} fontFamily="monospace" dominantBaseline="middle">{result.trimH}"</text>}
          {/* Butt joints */}
          {xPositions.slice(1).map((xp,i)=><g key={i}><line x1={xp} y1={oy} x2={xp} y2={oy+rh} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/><text x={xp} y={oy+rh+12} textAnchor="middle" fill={jointTextFill} fontSize={7} fontFamily="monospace">joint</text></g>)}
          {/* Dimensions */}
          <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
          <line x1={ox-10} y1={oy} x2={ox-10} y2={oy+ch} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox-14} y={oy+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
          {filters.length > 1 && <><line x1={ox} y1={oy-24} x2={ox+rw} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/>
          <text x={ox+rw/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{totalStockW.toFixed(2)}" combined</text></>}
          <line x1={ox+rw+10} y1={oy} x2={ox+rw+10} y2={oy+rh} stroke={stkDimStroke} strokeWidth={1}/>
          <text x={ox+rw+14} y={oy+rh/2} textAnchor="start" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace" dominantBaseline="middle">{totalStockH}" stk</text>
          {filters.map((f,i)=><text key={i} x={xPositions[i]+scaledWidths[i]/2} y={oy+rh+24} textAnchor="middle" fill={labelColors[i%labelColors.length]} fontSize={Math.min(9,100/filters.length)} fontFamily="monospace">{String.fromCharCode(65+i)}: {f.nomH}x{f.nomW}</text>)}
        </svg>
      );
    }
  }

  // Linear
  const filters = result.stockFilters;
  const totalW=filters.reduce((sum,f)=>sum+f.actW,0), maxH=filters[0].actH;
  const scale=Math.min(drawW/totalW, drawH/maxH);
  const scaledWidths=filters.map(f=>f.actW*scale);
  const rh=maxH*scale, totalRW=scaledWidths.reduce((a,b)=>a+b,0);
  const ox=(svgW-totalRW)/2, oy=(svgH-rh)/2;
  const cw=result.customActW*scale, ch=result.customActH*scale;
  const xPositions=[]; let lx=ox; for(const sw of scaledWidths){xPositions.push(lx);lx+=sw;}
  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
      {filters.map((f,i)=><rect key={i} x={xPositions[i]} y={oy} width={scaledWidths[i]} height={rh} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
      <rect x={ox} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
      {xPositions.slice(1).map((xp,i)=><g key={i}><line x1={xp} y1={oy} x2={xp} y2={oy+rh} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/><text x={xp} y={oy+rh+12} textAnchor="middle" fill={jointTextFill} fontSize={7} fontFamily="monospace">joint</text></g>)}
      {result.trimW>0&&<rect x={ox+cw} y={oy} width={totalRW-cw} height={ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
      {result.trimH>0&&<rect x={ox} y={oy+ch} width={totalRW} height={rh-ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
      <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
      <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
      <line x1={ox} y1={oy-24} x2={ox+totalRW} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/>
      <text x={ox+totalRW/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{totalW}" combined</text>
      {filters.map((f,i)=><text key={i} x={xPositions[i]+scaledWidths[i]/2} y={oy+rh+24} textAnchor="middle" fill={labelColors[i%labelColors.length]} fontSize={Math.min(9,100/filters.length)} fontFamily="monospace">{String.fromCharCode(65+i)}: {f.nomH}x{f.nomW}</text>)}
      <line x1={ox-10} y1={oy} x2={ox-10} y2={oy+ch} stroke={dimStroke} strokeWidth={1}/>
      <text x={ox-14} y={oy+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
      <text x={ox+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?11:13} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP</text>
    </svg>
  );
}

// ─── STOCK SUMMARY HELPER ─────────────────────────────────────────────────────
function calcStockSummary(cartItems) {
  const map = {};
  for (const item of cartItems) {
    if (!item.selectedResult) continue;
    const rawQty = item.qty || 1;
    const yieldsPerStock = item.selectedResult.yieldsPerStock || 1;
    const stockSets = Math.ceil(rawQty / yieldsPerStock);
    const prod = PRODUCTS.find(p => p.id === item.productId) || PRODUCTS[0];
    for (const sf of item.selectedResult.stockFilters) {
      const nomLabel = sf.rotated ? `${sf.origNomH}x${sf.origNomW}` : `${sf.nomH}x${sf.nomW}`;
      const sizeKey = `${nomLabel} x ${item.selectedResult.depth}"`;
      const key = `${item.productId}||${sizeKey}`;
      if (!map[key]) map[key] = { productId: item.productId, productShort: prod.short, productLabel: prod.label, sizeKey, qty: 0 };
      map[key].qty += stockSets;
    }
  }
  return Object.values(map).sort((a, b) => a.productLabel.localeCompare(b.productLabel) || a.sizeKey.localeCompare(b.sizeKey));
}

// ─── PRINT / MANUFACTURING SHEET ─────────────────────────────────────────────
function PrintSheet({ order, cartItems, onClose }) {
  const printRef = useRef(null);
  const stockSummary = calcStockSummary(cartItems);
  const today = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });

  const handlePrint = () => {
    const printContent = printRef.current.innerHTML;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><title>Mfg Sheet — ${order.orderNumber}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'JetBrains Mono',monospace;background:#fff;color:#111;font-size:11px;}
      .page{width:8.5in;min-height:11in;padding:0.5in;page-break-after:always;}
      .page:last-child{page-break-after:auto;}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px;}
      .hdr-left h1{font-size:18px;font-weight:700;letter-spacing:-0.5px;}
      .hdr-left .sub{font-size:11px;color:#000;font-weight:600;margin-top:2px;}
      .hdr-right{text-align:right;font-size:11px;line-height:1.6;}
      .badge{display:inline-block;background:#111;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:1px;}
      .item-block{border:1px solid #999;border-radius:4px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid;}
      .item-hdr{background:#e8e8e8;border-bottom:1px solid #999;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;color:#000;}
      .item-hdr .title{font-size:12px;font-weight:700;}
      .item-hdr .meta{font-size:10px;color:#000;font-weight:600;}
      .item-body{display:grid;grid-template-columns:1fr 260px;gap:0;}
      .item-info{padding:10px 12px;border-right:1px solid #ccc;color:#000;}
      .item-info .row{display:flex;gap:12px;margin-bottom:6px;flex-wrap:wrap;}
      .item-info .lbl{font-size:9px;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:.5px;display:block;}
      .item-info .val{font-size:12px;font-weight:600;}
      .item-info .stock-row{font-size:11px;margin-bottom:3px;}
      .item-info .pref{color:#000;font-size:9px;}
      .item-info .rot{color:#000;font-size:9px;}
      .cut-note{background:#f0f0f0;border:1px solid #999;padding:6px 10px;font-size:10px;color:#000;font-weight:600;}
      .item-diagram{padding:8px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #ccc;}
      .item-diagram svg{width:100%;max-height:180px;}
      .summary-page{width:8.5in;padding:0.5in;}
      .sum-hdr{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px;}
      .sum-hdr h2{font-size:16px;font-weight:700;}
      .sum-table{width:100%;border-collapse:collapse;font-size:11px;}
      .sum-table th{background:#111;color:#fff;text-align:left;padding:6px 10px;}
      .sum-table td{padding:6px 10px;border-bottom:1px solid #ccc;color:#000;}
      .sum-table tr:nth-child(even) td{background:#fff;}
      .sum-total{font-weight:700;background:#fff!important;}
      .footer{margin-top:20px;font-size:9px;color:#000;text-align:center;}
    </style></head><body>${printContent}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <span className="text-white font-bold font-mono">Manufacturing Sheet Preview</span>
          <span className="text-slate-400 text-sm font-mono ml-3">Order: {order.orderNumber} — {order.customerName}</span>
        </div>
        <div className="flex gap-3">
          <button onClick={handlePrint} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded text-sm font-mono flex items-center gap-2">
            🖨 Print / Save PDF
          </button>
          <button onClick={onClose} className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-4 py-2 rounded text-sm font-mono">Close</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-slate-800 p-6">
        <div ref={printRef} style={{ color:"#000", fontFamily:"'JetBrains Mono',monospace" }}>
          {/* Page 1+: One item per block */}
          {cartItems.map((item, idx) => {
            if (!item.selectedResult) return null;
            const r = item.selectedResult;
            const prod = PRODUCTS.find(p => p.id === item.productId) || PRODUCTS[0];
            return (
              <div key={item.id} className="page" style={{ background:"#fff", color:"#000", fontFamily:"'JetBrains Mono',monospace", width:"100%", minHeight:"min-content", padding:"0.5in", marginBottom:"8px", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>
                {/* Header */}
                <div className="hdr" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", borderBottom:"2px solid #111", paddingBottom:"10px", marginBottom:"16px" }}>
                  <div>
                    <div style={{ fontSize:"18px", fontWeight:"700", letterSpacing:"-0.5px" }}>Manufacturing Cut Sheet</div>
                    <div style={{ fontSize:"11px", fontWeight:"600", marginTop:"2px" }}>General Aire Systems, Inc. — Warehouse Production</div>
                  </div>
                  <div style={{ textAlign:"right", fontSize:"11px", lineHeight:"1.7" }}>
                    <div><strong>Order:</strong> {order.orderNumber}</div>
                    <div><strong>Customer:</strong> {order.customerName}</div>
                    <div><strong>Date:</strong> {today}</div>
                    <div><strong>Item:</strong> {idx+1} of {cartItems.filter(i=>i.selectedResult).length}</div>
                  </div>
                </div>
                {/* Item block */}
                <div className="item-block" style={{ border:"1px solid #ddd", borderRadius:"4px", overflow:"hidden" }}>
                  {/* Item header — custom size lives here only */}
                  <div className="item-hdr" style={{ background:"#f5f5f5", borderBottom:"1px solid #ddd", padding:"6px 10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:"12px", fontWeight:"700" }}>
                      Line {idx+1} — {item.customH}" × {item.customW}" × {toActualDepth(r.depth)}" — {prod.label}
                    </span>
                    <span style={{ fontSize:"10px", fontWeight:"600" }}>
                      QTY: {item.qty} &nbsp;|&nbsp; {cutMethodLabel(r)} &nbsp;|&nbsp; Drawing: {prod.drawing}
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 280px" }}>
                    {/* Info — size block removed; Qty and MERV moved to front */}
                    <div style={{ padding:"10px 12px", borderRight:"1px solid #eee" }}>
                      <div style={{ display:"flex", gap:"20px", marginBottom:"10px" }}>
                        <div>
                          <span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", display:"block" }}>Qty to Cut</span>
                          <span style={{ fontSize:"13px", fontWeight:"700" }}>{item.qty}</span>
                        </div>
                        <div>
                          <span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", display:"block" }}>MERV</span>
                          <span style={{ fontSize:"13px", fontWeight:"700" }}>{prod.merv}</span>
                        </div>
                        <div>
                          <span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", display:"block" }}>Depth (Actual)</span>
                          <span style={{ fontSize:"13px", fontWeight:"700" }}>{toActualDepth(r.depth)}"</span>
                        </div>
                      </div>
                      <div style={{ marginBottom:"8px" }}>
                        <span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", display:"block", marginBottom:"4px" }}>Stock Filter(s) Required</span>
                        {r.stockFilters.map((sf, si) => {
                          const nomLabel = sf.rotated ? `${sf.origNomH}x${sf.origNomW}` : `${sf.nomH}x${sf.nomW}`;
                          const yieldsPerStock = r.yieldsPerStock || 1;
                          const stockSets = Math.ceil(item.qty / yieldsPerStock);
                          return (
                            <div key={si} style={{ fontSize:"12px", marginBottom:"3px" }}>
                              {r.stockFilters.length > 1 && <span style={{ fontWeight:"700" }}>{String.fromCharCode(65+si)}: </span>}
                              <strong>{nomLabel} x {r.depth}"</strong>
                              {r.multiYield
                                ? <span style={{ fontSize:"10px" }}> — pull {stockSets} → makes {stockSets * yieldsPerStock}</span>
                                : <span style={{ fontSize:"10px" }}> × {item.qty} = <strong>{item.qty} pc</strong></span>
                              }
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display:"flex", gap:"16px", marginBottom:"8px" }}>
                        <div><span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", display:"block" }}>Trim Height</span><span style={{ fontSize:"11px", fontWeight:"600" }}>{r.trimH > 0 ? `${r.trimH}"` : "None"}</span></div>
                        <div><span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", display:"block" }}>Trim Width</span><span style={{ fontSize:"11px", fontWeight:"600" }}>{r.trimW > 0 ? `${r.trimW}"` : "None"}</span></div>
                        <div><span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", display:"block" }}>Cuts</span><span style={{ fontSize:"11px", fontWeight:"600" }}>{r.cuts}</span></div>
                        <div><span style={{ fontSize:"9px", fontWeight:"700", textTransform:"uppercase", display:"block" }}>Waste</span><span style={{ fontSize:"11px", fontWeight:"600" }}>{r.wasteArea.toFixed(1)} sq in</span></div>
                      </div>
                      {(r.type !== "single" || r.multiYield) && (
                        <div style={{ background:"#f0f0f0", border:"1px solid #999", borderRadius:"3px", padding:"6px 8px", fontSize:"10px", color:"#111" }}>
                          {r.multiYield
                            ? r.stockFilters.length > 1
                              ? `MULTI-YIELD: ${r.stockFilters.length} filters butted along width (${r.combinedW}" combined) — cut ${r.splitDirection === "height" ? "2 across height" : "2 across width"}, each ${item.customH}" × ${item.customW}" — waste in middle`
                              : `MULTI-YIELD: cut ${r.splitDirection === "height" ? "2 across height" : "2 across width"} from single stock — each ${item.customH}" × ${item.customW}" — waste in middle`
                            : r.layout === "grid"
                              ? `${r.gridRows}×${r.gridCols} grid — ${r.stockFilters.length} filters — butt and tape seams, then trim to ${item.customW}" × ${item.customH}"`
                              : `${r.stockFilters.length} filters butted along width — combined ${r.combinedW}" → trim to ${item.customW}"`}
                        </div>
                      )}
                    </div>
                    {/* Diagram */}
                    <div style={{ padding:"8px", background:"#fff", border:"1px solid #ccc", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <CutDiagram result={r} compact={true} printMode={true} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Summary Page */}
          <div className="summary-page" style={{ background:"#fff", color:"#000", fontFamily:"'JetBrains Mono',monospace", width:"100%", padding:"0.5in", marginBottom:"8px", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>
            <div style={{ borderBottom:"2px solid #111", paddingBottom:"10px", marginBottom:"16px", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:"18px", fontWeight:"700" }}>Stock Filter Allocation Summary</div>
                <div style={{ fontSize:"11px", fontWeight:"600", marginTop:"2px" }}>General Aire Systems, Inc. — Pull against sales order</div>
              </div>
              <div style={{ textAlign:"right", fontSize:"11px", lineHeight:"1.7" }}>
                <div><strong>Order:</strong> {order.orderNumber}</div>
                <div><strong>Customer:</strong> {order.customerName}</div>
                <div><strong>Date:</strong> {today}</div>
              </div>
            </div>

            {/* Cart summary table */}
            <div style={{ marginBottom:"20px" }}>
              <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", marginBottom:"6px" }}>Custom Filter Line Items</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px" }}>
                <thead>
                  <tr style={{ background:"#111", color:"#fff" }}>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Line</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Product</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Custom Size</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Depth</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Qty</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Cut Method</th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.filter(i=>i.selectedResult).map((item, idx) => {
                    const prod = PRODUCTS.find(p => p.id === item.productId) || PRODUCTS[0];
                    const r = item.selectedResult;
                    return (
                      <tr key={item.id} style={{ background:"#fff" }}>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>{idx+1}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>{prod.short}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc", fontWeight:"700" }}>{item.customH}" × {item.customW}" × {toActualDepth(r.depth)}"</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>{r.depth}"</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc", fontWeight:"700" }}>{item.qty}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>
                          {cutMethodLabel(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Stock allocation table */}
            <div>
              <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase", letterSpacing:".5px", marginBottom:"6px" }}>Stock Filter Pull List (Total Units Required)</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px" }}>
                <thead>
                  <tr style={{ background:"#111", color:"#fff" }}>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>#</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Product</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Stock Filter Size</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Preferred?</th>
                    <th style={{ padding:"6px 10px", textAlign:"right" }}>Qty to Pull</th>
                    <th style={{ padding:"6px 10px", textAlign:"left" }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {stockSummary.map((row, idx) => {
                    const [nomH, nomW] = row.sizeKey.split(" x ")[0].split("x").map(Number);
                    const pref = isPreferred(nomH, nomW);
                    return (
                      <tr key={idx} style={{ background:"#fff" }}>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>{idx+1}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc", fontWeight:"700" }}>{row.productLabel}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc", fontWeight:"700" }}>{row.sizeKey}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>{pref ? "★ Yes" : "—"}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc", fontWeight:"700", textAlign:"right", fontSize:"14px" }}>{row.qty}</td>
                        <td style={{ padding:"6px 10px", borderBottom:"1px solid #ccc" }}>Pull from bin</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background:"#fff", fontWeight:"700" }}>
                    <td colSpan={4} style={{ padding:"8px 10px", borderTop:"2px solid #111" }}>TOTAL STOCK FILTERS</td>
                    <td style={{ padding:"8px 10px", borderTop:"2px solid #111", textAlign:"right", fontSize:"14px" }}>{stockSummary.reduce((s,r)=>s+r.qty,0)}</td>
                    <td style={{ padding:"8px 10px", borderTop:"2px solid #111" }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop:"20px", fontSize:"9px", color:"#000", textAlign:"center" }}>
              Generated by Filter Cut Database — General Aire Systems, Inc. — {today}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FilterCutDB() {
  const [customH, setCustomH]       = useState("");
  const [customW, setCustomW]       = useState("");
  const [depth, setDepth]           = useState(1);
  const [productId, setProductId]   = useState("aeropleat3");
  const [qty, setQty]               = useState(1);
  const [results, setResults]       = useState(null);
  const [searched, setSearched]     = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const [cartItems, setCartItems]   = useState([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");

  const [view, setView]             = useState("builder");
  const [showPrint, setShowPrint]   = useState(false);
  const [showInventory, setShowInventory] = useState(false);

  const handleSearch = useCallback(() => {
    const h = parseFloat(customH), w = parseFloat(customW);
    if (!h || !w || h <= 0 || w <= 0) return;
    const r = findBestCut(h, w, depth, qty);
    setResults(r);
    setSearched(true);
    setSelectedIdx(0);
  }, [customH, customW, depth, qty]);

  const handleAddToCart = () => {
    if (!results || !results[selectedIdx]) return;
    const item = {
      id: Date.now(),
      productId,
      customH: parseFloat(customH),
      customW: parseFloat(customW),
      qty,
      depth,
      selectedResult: results[selectedIdx],
    };
    setCartItems(prev => [...prev, item]);
    setView("cart");
  };

  const removeCartItem = (id) => setCartItems(prev => prev.filter(i => i.id !== id));

  const updateQty = (id, newQty) => {
    const q = Math.max(1, parseInt(newQty) || 1);
    setCartItems(prev => prev.map(i => i.id === id ? { ...i, qty: q } : i));
  };

  const stockSummary = useMemo(() => calcStockSummary(cartItems), [cartItems]);
  const totalCustomFilters = useMemo(() => cartItems.reduce((s, i) => s + (i.qty || 1), 0), [cartItems]);
  const totalStockFilters = useMemo(() => stockSummary.reduce((s, row) => s + row.qty, 0), [stockSummary]);

  const canGenerate = cartItems.length > 0 && cartItems.every(i => i.selectedResult);

  const tabs = [
    { id:"builder", label:"Filter Builder" },
    { id:"cart",    label:`Order Cart (${cartItems.length})` },
    { id:"summary", label:"Stock Summary" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'JetBrains Mono','SF Mono','Fira Code',monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {showPrint && <PrintSheet order={{ orderNumber, customerName }} cartItems={cartItems} onClose={() => setShowPrint(false)} />}

      {/* Top bar */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Filter Cut Database</h1>
            <p className="text-xs text-slate-500 mt-0.5">General Aire Systems, Inc. — Custom filter manufacturing</p>
          </div>
          <div className="flex items-center gap-3">
            {cartItems.length > 0 && (
              <button
                onClick={() => setShowPrint(true)}
                disabled={!canGenerate}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold px-4 py-2 rounded text-xs transition-colors flex items-center gap-1.5"
              >
                🖨 Generate Mfg Sheet
              </button>
            )}
            <button onClick={() => setShowInventory(!showInventory)} className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-3 py-1.5 transition-colors">
              {showInventory ? "Hide" : "Show"} Inventory
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 flex gap-1 pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-t transition-colors border-b-2 ${view === t.id ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {showInventory && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Stock Inventory — {depth}" Depth</div>
            <div className="flex flex-wrap gap-1.5">
              {STOCK[depth]?.map(([h,w],i) => (
                <span key={i} className={`text-xs font-mono px-2 py-1 rounded border ${isPreferred(h,w) ? "bg-amber-950/30 border-amber-700/50 text-amber-400" : "bg-slate-800 border-slate-700/50 text-slate-300"}`}>
                  {h}x{w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── BUILDER TAB ── */}
        {view === "builder" && (
          <div className="space-y-5">
            <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Order Information</div>
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Order Number</label>
                  <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="e.g. ORD0107343"
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-44 focus:outline-none focus:border-emerald-500 placeholder-slate-600" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Customer Name</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. ACME Corp"
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-56 focus:outline-none focus:border-emerald-500 placeholder-slate-600" />
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-4">Build Custom Filter</div>
              <div className="mb-4">
                <label className="text-xs text-slate-500 block mb-2">Product</label>
                <div className="flex flex-wrap gap-2">
                  {PRODUCTS.map(p => (
                    <button key={p.id} onClick={() => setProductId(p.id)}
                      className={`px-3 py-2 text-xs rounded border transition-colors ${productId === p.id ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}>
                      <span className="font-semibold">{p.label}</span>
                      <span className="ml-1.5 opacity-60">MERV {p.merv}</span>
                      {p.drawing !== "—" && <span className="ml-1.5 opacity-50 text-xs">#{p.drawing}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Height (H)</label>
                  <input type="number" value={customH} onChange={e=>setCustomH(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                    placeholder="e.g. 18" step="0.25" min="1"
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-28 focus:outline-none focus:border-emerald-500 placeholder-slate-600" />
                </div>
                <span className="text-slate-600 text-lg pb-2">×</span>
                <div>
                  <label className="text-xs text-slate.500 block mb-1">Width (W)</label>
                  <input type="number" value={customW} onChange={e=>setCustomW(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                    placeholder="e.g. 30" step="0.25" min="1"
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-28 focus:outline-none focus:border-emerald-500 placeholder-slate-600" />
                </div>
                <span className="text-slate-600 text-lg pb-2">×</span>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Depth</label>
                  <div className="flex gap-1">
                    {[1,2,4].map(d => (
                      <button key={d} onClick={()=>{setDepth(d);setResults(null);setSearched(false);}}
                        className={`px-3 py-2 text-sm rounded border transition-colors ${depth===d?"bg-emerald-600 border-emerald-500 text-white":"bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}>
                        {d}"
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ml-6">
                  <label className="text-xs text-slate-500 block mb-1">Qty</label>
                  <input type="number" value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))} min="1"
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-20 focus:outline-none focus:border-emerald-500" />
                </div>
                <button onClick={handleSearch}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-2 rounded text-sm transition-colors">
                  Find Cut
                </button>
              </div>
              {customH && customW && (
                <div className="mt-2 text-xs text-slate-500">
                  Exact: {parseFloat(customH)||0}" H × {parseFloat(customW)||0}" W × {toActualDepth(depth)}" D &nbsp;|&nbsp; Product: {PRODUCTS.find(p=>p.id===productId)?.label}
                </div>
              )}
            </div>

            {searched && !results && (
              <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-6 text-center">
                <div className="text-red-400 font-semibold text-sm">No Solution Found</div>
                <div className="text-red-400/60 text-xs mt-1">No stock filter combination in {depth}" depth can produce {customH} × {customW}.</div>
              </div>
            )}

            {results && (
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <div className="sticky top-[105px] z-10 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-4 py-3 flex items-center justify-between">
                  <div className="text-xs text-slate-400 uppercase tracking-wider">{results.length} option{results.length!==1?"s":""} found — select a drawing below</div>
                  <button onClick={handleAddToCart}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2 rounded text-sm transition-colors flex items-center gap-2">
                    + Add to Cart <span className="bg-indigo-500/50 px-1.5 py-0.5 rounded text-xs">Option {selectedIdx+1}</span>
                  </button>
                </div>
                <div className="max-h-[620px] overflow-y-auto divide-y divide-slate-800/60">
                {results.map((r, i) => (
                  <div key={i} onClick={()=>setSelectedIdx(i)}
                    className={`cursor-pointer transition-all ${selectedIdx===i ? "bg-indigo-950/25" : i===0 ? "bg-emerald-950/10 hover:bg-emerald-950/20" : "bg-slate-800/10 hover:bg-slate-800/30"}`}>
                    <div className={`px-4 py-2.5 flex items-center justify-between ${selectedIdx===i?"bg-indigo-900/30":i===0?"bg-emerald-900/20":"bg-slate-800/40"}`}>
                      <div className="flex items-center gap-2">
                        {selectedIdx===i && <span className="text-xs font-bold text-indigo-300 bg-indigo-400/10 px-2 py-0.5 rounded">SELECTED</span>}
                        {i===0 && selectedIdx!==i && <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">BEST</span>}
                        <span className="text-sm font-mono text-slate-300">
                          Option {i+1} — {cutMethodLabel(r)}
                        </span>
                        {r.multiYield && <span className="text-xs font-bold text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded">×2 YIELD</span>}
                      </div>
                      <span className="text-xs font-mono text-slate-500">{r.wasteArea.toFixed(1)} sq in waste{r.multiYield ? ` · makes 2 per set` : ""}</span>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Stock Filter(s)</div>
                          {r.stockFilters.map((f,si) => (
                            <div key={si} className="text-sm font-mono text-white flex items-center flex-wrap gap-1">
                              {r.stockFilters.length>1&&<span className="text-slate-500">({String.fromCharCode(65+si)}) </span>}
                              {f.rotated?`${f.origNomH}x${f.origNomW}`:`${f.nomH}x${f.nomW}`} x {depth}
                              <span className="text-slate-500 text-xs">({f.actH}"×{f.actW}" actual)</span>
                              {f.rotated&&<span className="text-sky-400 text-xs">↻ rotated</span>}
                              {isPreferred(f.nomH,f.nomW)&&<span className="text-amber-400 text-xs bg-amber-400/10 px-1 py-0.5 rounded">★ pref</span>}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-5">
                          <div><div className="text-xs text-slate-500 uppercase mb-1">Trim H</div><div className="font-mono text-sm text-slate-300">{r.trimH>0?`${r.trimH}"`:"None"}</div></div>
                          <div><div className="text-xs text-slate-500 uppercase mb-1">Trim W</div><div className="font-mono text-sm text-slate-300">{r.trimW>0?`${r.trimW}"`:"None"}</div></div>
                          <div><div className="text-xs text-slate-500 uppercase mb-1">Cuts</div><div className="font-mono text-sm text-slate-300">{r.cuts}</div></div>
                        </div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg p-2 border border-slate-700/30">
                        <CutDiagram result={r} />
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CART TAB ── */}
        {view === "cart" && (
          <div className="space-y-5">
            <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Order Number</label>
                <input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)} placeholder="e.g. ORD0107343"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-44 focus:outline-none focus:border-emerald-500 placeholder-slate-600"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Customer Name</label>
                <input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="e.g. ACME Corp"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-56 focus:outline-none focus:border-emerald-500 placeholder-slate-600"/>
              </div>
              <button onClick={() => setView("builder")}
                className="border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white px-4 py-2 rounded text-sm transition-colors">
                + Add Filter
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-10 text-center">
                <div className="text-slate-400 text-sm">No items in cart yet.</div>
                <button onClick={()=>setView("builder")} className="mt-3 text-xs text-emerald-400 underline">Go to Filter Builder →</button>
              </div>
            ) : (
              <div className="space-y-3">
                {cartItems.map((item, idx) => {
                  const prod = PRODUCTS.find(p=>p.id===item.productId)||PRODUCTS[0];
                  const r = item.selectedResult;
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-700/50 bg-slate-800/20 overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-800/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">LINE {idx+1}</span>
                          <span className="text-sm font-mono text-white">{item.customH}" × {item.customW}" × {toActualDepth(r.depth)}"</span>
                          <span className="text-xs text-indigo-300 bg-indigo-900/30 border border-indigo-700/30 px-2 py-0.5 rounded">{prod.label}</span>
                          <span className="text-xs text-slate-400">
                            {cutMethodLabel(r)}
                          </span>
                          {r.multiYield && <span className="text-xs font-bold text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded">×2 YIELD</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-500">Qty:</label>
                            <input type="number" value={item.qty} min="1" onChange={e=>updateQty(item.id,e.target.value)}
                              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-sm w-16 focus:outline-none focus:border-emerald-500 text-center"/>
                          </div>
                          <button onClick={()=>removeCartItem(item.id)} className="text-red-400/60 hover:text-red-400 text-xs transition-colors">✕ Remove</button>
                        </div>
                      </div>
                      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-2">
                          <div className="text-xs text-slate-500 uppercase tracking-wider">
                            Stock Filters Needed {r.multiYield ? "(per set — makes 2 custom)" : "(per custom filter)"}
                          </div>
                          {r.stockFilters.map((sf,si)=>{
                            const yieldsPerStock = r.yieldsPerStock || 1;
                            const stockSets = Math.ceil(item.qty / yieldsPerStock);
                            return (
                            <div key={si} className="text-sm font-mono text-slate-300 flex items-center gap-2">
                              {r.stockFilters.length>1&&<span className="text-slate-500 text-xs">{String.fromCharCode(65+si)}:</span>}
                              <span className="text-white font-semibold">{sf.rotated?`${sf.origNomH}x${sf.origNomW}`:`${sf.nomH}x${sf.nomW}`} x {r.depth}"</span>
                              <span className="text-slate-500 text-xs">({sf.actH}"×{sf.actW}")</span>
                              {sf.rotated&&<span className="text-sky-400 text-xs">↻ rotated</span>}
                              {isPreferred(sf.nomH,sf.nomW)&&<span className="text-amber-400 text-xs">★</span>}
                              <span className="text-slate-500">×</span>
                              <span className="text-emerald-400 font-bold">{stockSets} pcs</span>
                              {r.multiYield && <span className="text-amber-300 text-xs">→ makes {stockSets * yieldsPerStock}</span>}
                            </div>
                            );
                          })}
                          <div className="flex gap-5 pt-1">
                            <div><span className="text-xs text-slate-500">Trim H: </span><span className="text-xs font-mono text-slate-300">{r.trimH>0?`${r.trimH}"`:"None"}</span></div>
                            <div><span className="text-xs text-slate-500">Trim W: </span><span className="text-xs font-mono text-slate-300">{r.trimW>0?`${r.trimW}"`:"None"}</span></div>
                            <div><span className="text-xs text-slate-500">Cuts: </span><span className="text-xs font-mono text-slate-300">{r.cuts}</span></div>
                          </div>
                        </div>
                        <div className="bg-slate-900/60 rounded p-2 border border-slate-700/30">
                          <CutDiagram result={r} compact={true}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div className="text-xs text-slate-500 font-mono">
                    {cartItems.length} line item{cartItems.length!==1?"s":""} &nbsp;|&nbsp; {totalCustomFilters} total custom filters &nbsp;|&nbsp; {totalStockFilters} stock filters to pull
                  </div>
                  <button onClick={()=>setShowPrint(true)} disabled={!canGenerate}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold px-6 py-2 rounded text-sm transition-colors flex items-center gap-2">
                    🖨 Generate Manufacturing Sheet
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SUMMARY TAB ── */}
        {view === "summary" && (
          <div className="space-y-5">
            <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">Stock Allocation Summary</div>
                  {orderNumber && <div className="text-sm text-white font-mono mt-1">Order: <span className="text-emerald-400">{orderNumber}</span>{customerName && <span> — {customerName}</span>}</div>}
                </div>
                <div className="flex gap-4 text-center">
                  <div><div className="text-2xl font-bold text-white">{cartItems.length}</div><div className="text-xs text-slate-500">Line Items</div></div>
                  <div className="border-l border-slate-700 pl-4"><div className="text-2xl font-bold text-emerald-400">{totalCustomFilters}</div><div className="text-xs text-slate-500">Custom Filters</div></div>
                  <div className="border-l border-slate-700 pl-4"><div className="text-2xl font-bold text-indigo-400">{totalStockFilters}</div><div className="text-xs text-slate-500">Stock to Pull</div></div>
                </div>
              </div>
            </div>

            {cartItems.length === 0 ? (
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-10 text-center">
                <div className="text-slate-400 text-sm">No items in cart yet.</div>
              </div>
            ) : (
              <>
                <div className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-slate-800/50 text-xs text-slate-400 uppercase tracking-wider">Order Line Items</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-800">
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Line</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Product</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Custom Size</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Qty</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Cut Method</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Stock Required</th>
                    </tr></thead>
                    <tbody>
                      {cartItems.map((item, idx) => {
                        const prod = PRODUCTS.find(p=>p.id===item.productId)||PRODUCTS[0];
                        const r = item.selectedResult;
                        if (!r) return null;
                        return (
                          <tr key={item.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                            <td className="px-4 py-3 text-slate-500">{idx+1}</td>
                            <td className="px-4 py-3 text-indigo-300 text-xs">{prod.short}</td>
                            <td className="px-4 py-3 font-mono text-white font-semibold">{item.customH}" × {item.customW}" × {toActualDepth(r.depth)}"</td>
                            <td className="px-4 py-3 text-emerald-400 font-bold">{item.qty}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{cutMethodLabel(r)}</td>
                            <td className="px-4 py-3 text-xs font-mono text-slate-300">
                              {r.stockFilters.map((sf,si)=>{
                                const yieldsPerStock = r.yieldsPerStock || 1;
                                const stockSets = Math.ceil(item.qty / yieldsPerStock);
                                return (
                                  <div key={si}>
                                    {sf.rotated?`${sf.origNomH}x${sf.origNomW}`:`${sf.nomH}x${sf.nomW}`} x {r.depth}"
                                    {r.multiYield
                                      ? <span> — pull {stockSets} → makes {stockSets * yieldsPerStock}</span>
                                      : <span> × {item.qty}</span>
                                    }
                                  </div>
                                );
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-slate-800/50 text-xs text-slate-400 uppercase tracking-wider">Stock Filter Pull List — Total Units to Allocate</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-800">
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">#</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Product</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Stock Filter Size</th>
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-normal">Preferred?</th>
                      <th className="text-right px-4 py-2.5 text-xs text-slate-500 font-normal">Total Qty to Pull</th>
                    </tr></thead>
                    <tbody>
                      {stockSummary.map((row, idx) => {
                        const [nomH, nomW] = row.sizeKey.split(" x ")[0].split("x").map(Number);
                        const pref = isPreferred(nomH, nomW);
                        return (
                          <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                            <td className="px-4 py-3 text-slate-600 text-xs">{idx+1}</td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-semibold text-indigo-300 bg-indigo-900/30 border border-indigo-700/30 px-2 py-1 rounded whitespace-nowrap">{row.productLabel}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-white font-semibold">{row.sizeKey}</td>
                            <td className="px-4 py-3">{pref ? <span className="text-amber-400 text-xs">★ Preferred</span> : <span className="text-slate-600 text-xs">—</span>}</td>
                            <td className="px-4 py-3 text-right font-mono text-emerald-400 font-bold text-lg">{row.qty}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-800/40 font-bold">
                        <td colSpan={4} className="px-4 py-3 text-white">TOTAL STOCK FILTERS</td>
                        <td className="px-4 py-3 text-right text-emerald-400 text-xl font-bold">{totalStockFilters}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <button onClick={()=>setShowPrint(true)} disabled={!canGenerate}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold px-6 py-2.5 rounded text-sm transition-colors flex items-center gap-2">
                    🖨 Generate Manufacturing Sheet
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
