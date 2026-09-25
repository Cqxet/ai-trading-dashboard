'use client';

import React from 'react';
import { TrendingUp, ArrowUpRight, ArrowDownRight, Eye } from 'lucide-react';

export interface ScannerRowData {
  symbol: string;
  price: number;
  change24hPct: number;
  quantScore: number;
  jevRegime: string;
  jevQuality: number;
  spreadBps: number;
  volatility: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  status: 'ACTIVE' | 'COOLDOWN' | 'FILTERED';
}

interface Props {
  rows: ScannerRowData[];
  selectedSymbol: string;
  onSelectRow: (symbol: string) => void;
  onOpenBreakdown: (symbol: string) => void;
}

export function MarketScannerTable({ rows, selectedSymbol, onSelectRow, onOpenBreakdown }: Props) {
  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-400 font-bold';
    if (score >= 50) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getSignalBadge = (sig: 'BUY' | 'SELL' | 'HOLD') => {
    if (sig === 'BUY') {
      return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    }
    if (sig === 'SELL') {
      return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
    }
    return 'bg-slate-800 text-slate-400';
  };

  return (
    <div className="bg-[#0f1422] border border-slate-800 rounded-xl overflow-hidden text-slate-200">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <h4 className="font-bold text-sm text-white">Multi-Asset Real-Time Scanner</h4>
          <span className="text-[10px] text-slate-400 font-mono">({rows.length} İzlenen Çift)</span>
        </div>
        <span className="text-[11px] text-slate-400 italic">
          *Detaylı Quant + JEV + Risk skorlarını görmek için satıra tıklayın
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="py-2.5 px-3">Sembol</th>
              <th className="py-2.5 px-3">Son Fiyat</th>
              <th className="py-2.5 px-3">24h Değişim</th>
              <th className="py-2.5 px-3">Quant Skoru</th>
              <th className="py-2.5 px-3">JEV Rejimi</th>
              <th className="py-2.5 px-3">JEV Kalitesi</th>
              <th className="py-2.5 px-3">Spread (bps)</th>
              <th className="py-2.5 px-3">Volatilite</th>
              <th className="py-2.5 px-3">Sinyal</th>
              <th className="py-2.5 px-3 text-right">İncele</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {rows.map((row) => {
              const isSelected = row.symbol === selectedSymbol;
              return (
                <tr
                  key={row.symbol}
                  onClick={() => onSelectRow(row.symbol)}
                  className={`hover:bg-indigo-950/20 cursor-pointer transition ${
                    isSelected ? 'bg-indigo-950/40 border-l-2 border-indigo-500' : ''
                  }`}
                >
                  <td className="py-2.5 px-3 font-bold text-white font-sans flex items-center gap-1.5">
                    <span>{row.symbol}</span>
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-200">
                    ${row.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-flex items-center gap-0.5 ${
                        row.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.change24hPct >= 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {row.change24hPct >= 0 ? `+${row.change24hPct.toFixed(2)}%` : `${row.change24hPct.toFixed(2)}%`}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={getScoreColor(row.quantScore)}>{row.quantScore}/100</span>
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-300">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-indigo-300">
                      {row.jevRegime}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-emerald-400">
                    %{row.jevQuality}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">
                    {row.spreadBps.toFixed(1)} bps
                  </td>
                  <td className="py-2.5 px-3 font-sans">
                    <span className="text-[10px] text-slate-400">{row.volatility}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getSignalBadge(row.signal)}`}>
                      {row.signal}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBreakdown(row.symbol);
                      }}
                      className="p-1 hover:bg-indigo-500/20 text-indigo-400 rounded transition"
                      title="Skor Ayrıştırma Detayı"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
