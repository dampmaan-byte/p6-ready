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
  { id: "aeropleat3",  label: "Camfil Aeropleat 3 MV8",  short: "Aeropleat 3" },
  { id: "3030",        label: "Camfil 30/30 MV8",        short: "30/30"       },
  { id: "aeropleat13", label: "Camfil Aeropleat 13 MV8", short: "Aeropleat 13"},
  { id: "mv8",         label: "Mann Hummel MV8",         short: "MV8"         },
  { id: "dual9",       label: "Camfil Dual MV9/9A",       short: "Dual MV9/9A" },
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

  const combos = (arr, n) => {
    if (n===1) return arr.map(x=>[x]);
    if (n===2) return arr.flatMap((x,i)=>arr.slice(i).map(y=>[x,y]));
    if (n===3) return arr.flatMap((x,i)=>arr.slice(i).flatMap((y,j)=>arr.slice(i+j).map(z=>[x,y,z])));
    if (n===4) return arr.flatMap((x,i)=>arr.slice(i).flatMap((y,j)=>arr.slice(i+j).flatMap((z,k)=>arr.slice(i+j+k).map(w=>[x,y,z,w]))));
    return [];
  };
  const smallGridConfigs=[[2,2],[2,3],[3,2],[3,3],[2,4],[4,2]];
  for (const [nRows,nCols] of smallGridConfigs) {
    const hCombos=combos(uniqueHeights,nRows), wCombos=combos(uniqueWidths,nCols);
    for (const rh of hCombos) { const totalH=rh.reduce((a,b)=>a+b,0); if(totalH<needH) continue; for (const cw of wCombos) { const totalW=cw.reduce((a,b)=>a+b,0); if(totalW<needW) continue; addGridResult(rh,cw); } }
  }
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
    for (const f of allOrientations) addMultiYield([f], f.actH, f.actW);
    for (const [hKey, filters] of Object.entries(byActH)) {
      const actH = parseFloat(hKey);
      const tryCombo = (combo) => addMultiYield(combo, actH, combo.reduce((s,f)=>s+f.actW,0));
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) tryCombo([filters[i],filters[j]]);
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) tryCombo([filters[i],filters[j],filters[k]]);
      for (let i=0;i<filters.length;i++) for (let j=i;j<filters.length;j++) for (let k=j;k<filters.length;k++) for (let l=k;l<filters.length;l++) tryCombo([filters[i],filters[j],filters[k],filters[l]]);
    }
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

  // PRIMARY GOAL: Use the fewest filters possible (1 filter is always best)
  // Secondary: Among same filter count, prefer less waste area
  // Tertiary: Among same waste, prefer preferred stock sizes
  // Quaternary: Fewer cuts is better
  const prefScore = (r) => {
    const allPref = r.stockFilters.every(f => isPreferred(f.nomH, f.nomW));
    const somePref = r.stockFilters.some(f => isPreferred(f.nomH, f.nomW));
    if (allPref) return 0;
    if (somePref) return 1;
    return 2;
  };
  results.sort((a, b) => 
    // 1. Fewest filters first (most important)
    a.stockFilters.length - b.stockFilters.length ||
    // 2. Less waste area
    a.wasteArea - b.wasteArea ||
    // 3. Preferred stock sizes
    prefScore(a) - prefScore(b) ||
    // 4. Fewer cuts
    a.cuts - b.cuts
  );
  return results.length>0?results.slice(0,8):null;
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
  const stockFill    = P ? "#e8e8e8"  : "#e2e8f0";
  const stockStroke  = P ? "#111"     : "#94a3b8";
  const keepFill     = P ? "#ddd"     : "#0066B3";
  const keepFillOp   = P ? 0.9        : 0.2;
  const keepStroke   = P ? "#111"     : "#0066B3";
  const wasteFill    = P ? "#fff"     : "#dc2626";
  const wasteFillOp  = P ? 0          : 0.1;
  const wasteStroke  = P ? "#555"     : "#ef4444";
  const dimStroke    = P ? "#111"     : "#0066B3";
  const dimFill      = P ? "#111"     : "#0066B3";
  const stkDimStroke = P ? "#555"     : "#64748b";
  const stkDimFill   = P ? "#555"     : "#64748b";
  const keepTextFill = P ? "#000"     : "#0066B3";
  const wasteTextFill= P ? "#444"     : "#dc2626";
  const jointStroke  = P ? "#333"     : "#f59e0b";
  const jointTextFill= P ? "#333"     : "#f59e0b";
  const filterColors = P
    ? ["#bbb","#999","#777","#555","#888","#aaa"]
    : ["#94a3b8","#0066B3","#3b82f6","#6366f1","#0ea5e9","#14b8a6"];
  const labelColors  = P
    ? ["#222","#333","#444","#555","#666","#777"]
    : ["#64748b","#0066B3","#2563eb","#4f46e5","#0284c7","#0d9488"];
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
      const midW = result.trimH * scale;
      const keep1Y = oy, wasteY = oy + ch, keep2Y = oy + ch + midW;
      const scaledWidths = filters.map(f => f.actW * scale);
      const xPositions = []; let lx = ox; for (const sw of scaledWidths) { xPositions.push(lx); lx += sw; }
      return (
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
          {filters.map((f,i)=><rect key={i} x={xPositions[i]} y={oy} width={scaledWidths[i]} height={rh} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
          <rect x={ox} y={keep1Y} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={ox+cw/2} y={keep1Y+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 1</text>
          {midW > 0 && <rect x={ox} y={wasteY} width={rw} height={midW} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {midW > 0 && <text x={ox+rw/2} y={wasteY+midW/2} textAnchor="middle" fill={wasteTextFill} fontSize={7} fontFamily="monospace" dominantBaseline="middle">{result.trimH}" waste</text>}
          <rect x={ox} y={keep2Y} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={ox+cw/2} y={keep2Y+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 2</text>
          {result.trimW > 0 && <rect x={ox+cw} y={oy} width={rw-cw} height={rh} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {xPositions.slice(1).map((xp,i)=><g key={i}><line x1={xp} y1={oy} x2={xp} y2={oy+rh} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/></g>)}
          <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
          {filters.length > 1 && <><line x1={ox} y1={oy-24} x2={ox+rw} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/><text x={ox+rw/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{totalStockW.toFixed(2)}" combined</text></>}
          <line x1={ox-10} y1={keep1Y} x2={ox-10} y2={keep1Y+ch} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox-14} y={keep1Y+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
          <line x1={ox+rw+10} y1={oy} x2={ox+rw+10} y2={oy+rh} stroke={stkDimStroke} strokeWidth={1}/>
          <text x={ox+rw+14} y={oy+rh/2} textAnchor="start" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace" dominantBaseline="middle">{totalStockH}" stk</text>
          {filters.map((f,i)=><text key={i} x={xPositions[i]+scaledWidths[i]/2} y={oy+rh+24} textAnchor="middle" fill={labelColors[i%labelColors.length]} fontSize={Math.min(9,100/filters.length)} fontFamily="monospace">{String.fromCharCode(65+i)}: {f.nomH}x{f.nomW}</text>)}
        </svg>
      );
    } else {
      const midW = result.trimW * scale;
      const keep1X = ox, wasteX = ox + cw, keep2X = ox + cw + midW;
      const scaledWidths = filters.map(f => f.actW * scale);
      const xPositions = []; let lx = ox; for (const sw of scaledWidths) { xPositions.push(lx); lx += sw; }
      return (
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: svgH, background: svgBg }}>
          {filters.map((f,i)=><rect key={i} x={xPositions[i]} y={oy} width={scaledWidths[i]} height={rh} fill={stockFill} stroke={filterColors[i%filterColors.length]} strokeWidth={1.5} rx={2} strokeDasharray={i>0?"6 3":"none"}/>)}
          <rect x={keep1X} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={keep1X+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 1</text>
          {midW > 0 && <rect x={wasteX} y={oy} width={midW} height={rh} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          <rect x={keep2X} y={oy} width={cw} height={ch} fill={keepFill} fillOpacity={keepFillOp} stroke={keepStroke} strokeWidth={2} rx={2}/>
          <text x={keep2X+cw/2} y={oy+ch/2} textAnchor="middle" fill={keepTextFill} fontSize={compact?9:11} fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">KEEP 2</text>
          {result.trimH > 0 && <rect x={ox} y={oy+ch} width={rw} height={rh-ch} fill={wasteFill} fillOpacity={wasteFillOp} stroke={wasteStroke} strokeWidth={1} strokeDasharray="4 2"/>}
          {xPositions.slice(1).map((xp,i)=><g key={i}><line x1={xp} y1={oy} x2={xp} y2={oy+rh} stroke={jointStroke} strokeWidth={2} strokeDasharray="4 3"/></g>)}
          <line x1={ox} y1={oy-10} x2={ox+cw} y2={oy-10} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox+cw/2} y={oy-15} textAnchor="middle" fill={dimFill} fontSize={fontSize} fontFamily="monospace">{result.customActW}"</text>
          <line x1={ox-10} y1={oy} x2={ox-10} y2={oy+ch} stroke={dimStroke} strokeWidth={1}/>
          <text x={ox-14} y={oy+ch/2} textAnchor="end" fill={dimFill} fontSize={fontSize} fontFamily="monospace" dominantBaseline="middle">{result.customActH}"</text>
          {filters.length > 1 && <><line x1={ox} y1={oy-24} x2={ox+rw} y2={oy-24} stroke={stkDimStroke} strokeWidth={1}/><text x={ox+rw/2} y={oy-29} textAnchor="middle" fill={stkDimFill} fontSize={fontSize-1} fontFamily="monospace">{totalStockW.toFixed(2)}" combined</text></>}
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
                      QTY: {item.qty} &nbsp;|&nbsp; Drawing: {prod.drawing}
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
                          return (
                            <div key={si} style={{ fontSize:"12px", marginBottom:"3px" }}>
                              {r.stockFilters.length > 1 && <span style={{ fontWeight:"700" }}>{String.fromCharCode(65+si)}: </span>}
                              <strong>{nomLabel} x {r.depth}"</strong>
                              <span style={{ fontSize:"10px" }}> × {item.qty} = <strong>{item.qty} pc</strong></span>
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
                      {r.type !== "single" && (
                        <div style={{ background:"#f0f0f0", border:"1px solid #999", borderRadius:"3px", padding:"6px 8px", fontSize:"10px", color:"#111" }}>
                          {r.layout === "grid"
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
  const clearCart = () => setCartItems([]);

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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {showPrint && <PrintSheet order={{ orderNumber, customerName }} cartItems={cartItems} onClose={() => setShowPrint(false)} />}

      {/* Top bar */}
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <img src="/logo.jpg" alt="General Aire Systems" className="h-14 w-auto" />
            <div className="border-l border-slate-200 pl-5">
              <h1 className="text-2xl font-bold text-[#0066B3] tracking-tight">Filter Cut Database</h1>
              <p className="text-sm text-slate-500 mt-0.5">Custom filter manufacturing optimization</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {cartItems.length > 0 && (
              <button
                onClick={() => setShowPrint(true)}
                disabled={!canGenerate}
                className="bg-[#0066B3] hover:bg-[#005299] disabled:bg-slate-300 disabled:text-slate-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                Generate Mfg Sheet
              </button>
            )}
            <button onClick={() => setShowInventory(!showInventory)} className="text-sm text-slate-600 hover:text-[#0066B3] border border-slate-300 hover:border-[#0066B3] rounded-lg px-4 py-2 transition-colors">
              {showInventory ? "Hide" : "Show"} Inventory
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-8 flex gap-2 pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${view === t.id ? "border-[#0066B3] text-[#0066B3] bg-slate-50" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">

        {showInventory && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Stock Inventory - {depth}" Depth</div>
            <div className="flex flex-wrap gap-2">
              {STOCK[depth]?.map(([h,w],i) => (
                <span key={i} className={`text-sm font-mono px-3 py-1.5 rounded-lg border ${isPreferred(h,w) ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200 text-slate-600"}`}>
                  {h}x{w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── BUILDER TAB ── */}
        {view === "builder" && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Order Information</div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <label className="text-sm font-medium text-slate-600 block mb-2">Order Number</label>
                  <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="e.g. ORD0107343"
                    className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-48 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-600 block mb-2">Customer Name</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. ACME Corp"
                    className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-60 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-5">Build Custom Filter</div>
              <div className="mb-6">
                <label className="text-sm font-medium text-slate-600 block mb-3">Product</label>
                <div className="flex flex-wrap gap-3">
                  {PRODUCTS.map(p => (
                    <button key={p.id} onClick={() => setProductId(p.id)}
                      className={`px-4 py-2.5 text-sm rounded-lg border-2 transition-all font-semibold ${productId === p.id ? "bg-[#0066B3] border-[#0066B3] text-white shadow-md" : "bg-white border-slate-200 text-slate-600 hover:border-[#0066B3]/50 hover:text-[#0066B3]"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-600 block mb-2">Height (H)</label>
                  <input type="number" value={customH} onChange={e=>setCustomH(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                    placeholder="e.g. 18" step="0.25" min="1"
                    className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-32 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all" />
                </div>
                <span className="text-slate-400 text-xl pb-2.5 font-light">x</span>
                <div>
                  <label className="text-sm font-medium text-slate-600 block mb-2">Width (W)</label>
                  <input type="number" value={customW} onChange={e=>setCustomW(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                    placeholder="e.g. 30" step="0.25" min="1"
                    className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-32 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all" />
                </div>
                <span className="text-slate-400 text-xl pb-2.5 font-light">x</span>
                <div>
                  <label className="text-sm font-medium text-slate-600 block mb-2">Depth</label>
                  <div className="flex gap-2">
                    {[1,2,4].map(d => (
                      <button key={d} onClick={()=>{setDepth(d);setResults(null);setSearched(false);}}
                        className={`px-4 py-2.5 text-sm rounded-lg border-2 transition-all ${depth===d?"bg-[#0066B3] border-[#0066B3] text-white shadow-md":"bg-white border-slate-200 text-slate-600 hover:border-[#0066B3]/50"}`}>
                        {d}"
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ml-4">
                  <label className="text-sm font-medium text-slate-600 block mb-2">Qty</label>
                  <input type="number" value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))} min="1"
                    className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-24 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 transition-all text-center" />
                </div>
                <button onClick={handleSearch}
                  className="bg-[#0066B3] hover:bg-[#005299] text-white font-semibold px-8 py-2.5 rounded-lg text-sm transition-all shadow-sm hover:shadow-md">
                  Find Cut
                </button>
              </div>
              {customH && customW && (
                <div className="mt-4 text-sm text-slate-500 bg-slate-50 rounded-lg px-4 py-2 inline-block">
                  Exact: <span className="font-mono font-medium text-slate-700">{parseFloat(customH)||0}" H x {parseFloat(customW)||0}" W x {toActualDepth(depth)}" D</span> | Product: <span className="font-medium text-[#0066B3]">{PRODUCTS.find(p=>p.id===productId)?.label}</span>
                </div>
              )}
            </div>

            {searched && !results && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
                <div className="text-red-600 font-semibold text-base">No Solution Found</div>
                <div className="text-red-500 text-sm mt-2">No stock filter combination in {depth}" depth can produce {customH} x {customW}.</div>
              </div>
            )}

            {results && (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between shadow-sm">
                  <div className="text-sm text-slate-500">{results.length} option{results.length!==1?"s":""} found - select a drawing below</div>
                  <button onClick={handleAddToCart}
                    className="bg-[#0066B3] hover:bg-[#005299] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-all shadow-sm hover:shadow-md flex items-center gap-2">
                    + Add to Cart <span className="bg-white/20 px-2 py-0.5 rounded text-xs">Option {selectedIdx+1}</span>
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm max-h-[620px] overflow-y-auto divide-y divide-slate-100">
                {results.map((r, i) => (
                  <div key={i} onClick={()=>setSelectedIdx(i)}
                    className={`cursor-pointer transition-all ${selectedIdx===i ? "bg-blue-50" : i===0 ? "bg-emerald-50/50 hover:bg-emerald-50" : "bg-white hover:bg-slate-50"}`}>
                    <div className={`px-5 py-3 flex items-center justify-between ${selectedIdx===i?"bg-blue-100/50":i===0?"bg-emerald-100/50":"bg-slate-50"}`}>
                      <div className="flex items-center gap-3">
                        {selectedIdx===i && <span className="text-xs font-bold text-[#0066B3] bg-blue-100 px-2.5 py-1 rounded-md">SELECTED</span>}
                        {i===0 && selectedIdx!==i && <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2.5 py-1 rounded-md">BEST</span>}
                        <span className="text-sm font-medium text-slate-700">
                          Option {i+1} - {cutMethodLabel(r)}
                        </span>
                      </div>
                      <span className="text-sm font-mono text-slate-500">{r.wasteArea.toFixed(1)} sq in waste</span>
                    </div>
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Stock Filter(s)</div>
                          {r.stockFilters.map((f,si) => (
                            <div key={si} className="text-sm font-mono text-slate-800 flex items-center flex-wrap gap-2 py-1">
                              {r.stockFilters.length>1&&<span className="text-slate-400">({String.fromCharCode(65+si)})</span>}
                              <span className="font-semibold">{f.rotated?`${f.origNomH}x${f.origNomW}`:`${f.nomH}x${f.nomW}`} x {depth}</span>
                              <span className="text-slate-400 text-xs">({f.actH}"x{f.actW}" actual)</span>
                              {f.rotated&&<span className="text-sky-600 text-xs bg-sky-50 px-1.5 py-0.5 rounded">rotated</span>}
                              {isPreferred(f.nomH,f.nomW)&&<span className="text-amber-600 text-xs bg-amber-50 px-1.5 py-0.5 rounded">preferred</span>}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-6">
                          <div><div className="text-xs font-semibold text-slate-500 uppercase mb-1">Trim H</div><div className="font-mono text-sm text-slate-700">{r.trimH>0?`${r.trimH}"`:"None"}</div></div>
                          <div><div className="text-xs font-semibold text-slate-500 uppercase mb-1">Trim W</div><div className="font-mono text-sm text-slate-700">{r.trimW>0?`${r.trimW}"`:"None"}</div></div>
                          <div><div className="text-xs font-semibold text-slate-500 uppercase mb-1">Cuts</div><div className="font-mono text-sm text-slate-700">{r.cuts}</div></div>
                        </div>
                      </div>
                      <div className="bg-slate-100 rounded-lg p-3 border border-slate-200">
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
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap gap-6 items-end shadow-sm">
              <div>
                <label className="text-sm font-medium text-slate-600 block mb-2">Order Number</label>
                <input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)} placeholder="e.g. ORD0107343"
                  className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-48 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all"/>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600 block mb-2">Customer Name</label>
                <input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="e.g. ACME Corp"
                  className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-sm w-60 focus:outline-none focus:border-[#0066B3] focus:ring-2 focus:ring-[#0066B3]/20 placeholder-slate-400 transition-all"/>
              </div>
              <button onClick={() => setView("builder")}
                className="border-2 border-slate-200 hover:border-[#0066B3] text-slate-600 hover:text-[#0066B3] px-5 py-2.5 rounded-lg text-sm transition-all font-medium">
                + Add Filter
              </button>
              {cartItems.length > 0 && (
                <button onClick={clearCart}
                  className="border-2 border-red-200 hover:border-red-400 text-red-500 hover:text-red-600 px-5 py-2.5 rounded-lg text-sm transition-all font-medium">
                  Clear Cart
                </button>
              )}
            </div>

            {cartItems.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
                <div className="text-slate-500 text-base">No items in cart yet.</div>
                <button onClick={()=>setView("builder")} className="mt-4 text-sm text-[#0066B3] hover:underline font-medium">Go to Filter Builder</button>
              </div>
            ) : (
              <div className="space-y-4">
                {cartItems.map((item, idx) => {
                  const prod = PRODUCTS.find(p=>p.id===item.productId)||PRODUCTS[0];
                  const r = item.selectedResult;
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      <div className="px-5 py-3.5 bg-slate-50 flex items-center justify-between border-b border-slate-100">
                        <div className="flex items-center gap-4">
                          <span className="text-xs font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-md">LINE {idx+1}</span>
                          <span className="text-sm font-mono font-semibold text-slate-800">{item.customH}" x {item.customW}" x {toActualDepth(r.depth)}"</span>
                          <span className="text-xs text-[#0066B3] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-md font-medium">{prod.label}</span>
                          <span className="text-xs text-slate-500">
                            {cutMethodLabel(r)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-slate-500">Qty:</label>
                            <input type="number" value={item.qty} min="1" onChange={e=>updateQty(item.id,e.target.value)}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-800 text-sm w-20 focus:outline-none focus:border-[#0066B3] text-center"/>
                          </div>
                          <button onClick={()=>removeCartItem(item.id)} className="text-red-500 hover:text-red-600 text-sm transition-colors font-medium">Delete Line</button>
                        </div>
                      </div>
                      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="md:col-span-2 space-y-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Filters Needed (per custom filter)</div>
                          {r.stockFilters.map((sf,si)=>(
                            <div key={si} className="text-sm font-mono text-slate-700 flex items-center gap-2">
                              {r.stockFilters.length>1&&<span className="text-slate-400 text-xs">{String.fromCharCode(65+si)}:</span>}
                              <span className="text-slate-800 font-semibold">{sf.rotated?`${sf.origNomH}x${sf.origNomW}`:`${sf.nomH}x${sf.nomW}`} x {r.depth}"</span>
                              <span className="text-slate-400 text-xs">({sf.actH}"x{sf.actW}")</span>
                              {sf.rotated&&<span className="text-sky-600 text-xs bg-sky-50 px-1.5 py-0.5 rounded">rotated</span>}
                              {isPreferred(sf.nomH,sf.nomW)&&<span className="text-amber-600 text-xs bg-amber-50 px-1.5 py-0.5 rounded">preferred</span>}
                              <span className="text-slate-300">x</span>
                              <span className="text-[#0066B3] font-bold">{item.qty} pcs</span>
                            </div>
                          ))}
                          <div className="flex gap-6 pt-2">
                            <div><span className="text-sm text-slate-500">Trim H: </span><span className="text-sm font-mono text-slate-700">{r.trimH>0?`${r.trimH}"`:"None"}</span></div>
                            <div><span className="text-sm text-slate-500">Trim W: </span><span className="text-sm font-mono text-slate-700">{r.trimW>0?`${r.trimW}"`:"None"}</span></div>
                            <div><span className="text-sm text-slate-500">Cuts: </span><span className="text-sm font-mono text-slate-700">{r.cuts}</span></div>
                          </div>
                        </div>
                        <div className="bg-slate-100 rounded-lg p-3 border border-slate-200">
                          <CutDiagram result={r} compact={true}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                  <div className="text-sm text-slate-500">
                    {cartItems.length} line item{cartItems.length!==1?"s":""} | {totalCustomFilters} total custom filters | {totalStockFilters} stock filters to pull
                  </div>
                  <button onClick={()=>setShowPrint(true)} disabled={!canGenerate}
                    className="bg-[#0066B3] hover:bg-[#005299] disabled:bg-slate-300 disabled:text-slate-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-all shadow-sm hover:shadow-md flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    Generate Manufacturing Sheet
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SUMMARY TAB ── */}
        {view === "summary" && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Stock Allocation Summary</div>
                  {orderNumber && <div className="text-base text-slate-800 font-medium mt-2">Order: <span className="text-[#0066B3]">{orderNumber}</span>{customerName && <span className="text-slate-600"> - {customerName}</span>}</div>}
                </div>
                <div className="flex gap-6 text-center">
                  <div><div className="text-3xl font-bold text-slate-800">{cartItems.length}</div><div className="text-xs text-slate-500 mt-1">Line Items</div></div>
                  <div className="border-l border-slate-200 pl-6"><div className="text-3xl font-bold text-[#0066B3]">{totalCustomFilters}</div><div className="text-xs text-slate-500 mt-1">Custom Filters</div></div>
                  <div className="border-l border-slate-200 pl-6"><div className="text-3xl font-bold text-emerald-600">{totalStockFilters}</div><div className="text-xs text-slate-500 mt-1">Stock to Pull</div></div>
                </div>
              </div>
            </div>

            {cartItems.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
                <div className="text-slate-500 text-base">No items in cart yet.</div>
              </div>
            ) : (
              <>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-5 py-4 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Order Line Items</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-200">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Line</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Size</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cut Method</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Required</th>
                    </tr></thead>
                    <tbody>
                      {cartItems.map((item, idx) => {
                        const prod = PRODUCTS.find(p=>p.id===item.productId)||PRODUCTS[0];
                        const r = item.selectedResult;
                        if (!r) return null;
                        return (
                          <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-5 py-4 text-slate-500">{idx+1}</td>
                            <td className="px-5 py-4"><span className="text-xs font-medium text-[#0066B3] bg-blue-50 px-2 py-1 rounded">{prod.short}</span></td>
                            <td className="px-5 py-4 font-mono text-slate-800 font-semibold">{item.customH}" x {item.customW}" x {toActualDepth(r.depth)}"</td>
                            <td className="px-5 py-4 text-[#0066B3] font-bold">{item.qty}</td>
                            <td className="px-5 py-4 text-slate-500 text-xs">{cutMethodLabel(r)}</td>
                            <td className="px-5 py-4 text-sm font-mono text-slate-600">
                              {r.stockFilters.map((sf,si)=>(
                                <div key={si}>{sf.rotated?`${sf.origNomH}x${sf.origNomW}`:`${sf.nomH}x${sf.nomW}`} x {r.depth}" x {item.qty}</div>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-5 py-4 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Stock Filter Pull List - Total Units to Allocate</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-200">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">#</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Filter Size</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Preferred?</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Qty to Pull</th>
                    </tr></thead>
                    <tbody>
                      {stockSummary.map((row, idx) => {
                        const [nomH, nomW] = row.sizeKey.split(" x ")[0].split("x").map(Number);
                        const pref = isPreferred(nomH, nomW);
                        return (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-5 py-4 text-slate-400 text-xs">{idx+1}</td>
                            <td className="px-5 py-4">
                              <span className="text-xs font-medium text-[#0066B3] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded whitespace-nowrap">{row.productLabel}</span>
                            </td>
                            <td className="px-5 py-4 font-mono text-slate-800 font-semibold">{row.sizeKey}</td>
                            <td className="px-5 py-4">{pref ? <span className="text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded">Preferred</span> : <span className="text-slate-400 text-xs">-</span>}</td>
                            <td className="px-5 py-4 text-right font-mono text-[#0066B3] font-bold text-lg">{row.qty}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50 font-bold">
                        <td colSpan={4} className="px-5 py-4 text-slate-800">TOTAL STOCK FILTERS</td>
                        <td className="px-5 py-4 text-right text-[#0066B3] text-xl font-bold">{totalStockFilters}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <button onClick={()=>setShowPrint(true)} disabled={!canGenerate}
                    className="bg-[#0066B3] hover:bg-[#005299] disabled:bg-slate-300 disabled:text-slate-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-all shadow-sm hover:shadow-md flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    Generate Manufacturing Sheet
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
