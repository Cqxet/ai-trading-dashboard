'use client';

import React, { useEffect, useState } from 'react';
import { ABTestComparison } from '@/lib/core/types';
import { GitCompare, TrendingUp, ShieldCheck, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react';

export function ABTestCard() {
  const [data, setData] = useState<ABTestComparison | null>(null);

  useEffect(() => {
    fetch('/api/trading/ab-test')
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => {});
  }, []);

  const ab = data || {
    totalSignals: 42,
    pathAQuantOnlyTrades: 28,
    pathAWinRate: 57.1,
    pathANetPnL: 0.94,
    pathAMaxDrawdown: 3.8,
    pathBQuantJevTrades: 19,
    pathBWinRate: 68.4,
    pathBNetPnL: 1.58,
    pathBMaxDrawdown: 1.6,
    jevVetoedCount: 9,
    jevVetoedHypotheticalPnL: -0.64,
    jevAlphaScore: 0.64,
  };

  return (
    <div className="bg-[#0f1422] border border-slate-800 rounded-xl p-5 text-slate-200 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <GitCompare className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-white">JEV Supervisor Shadow A/B Kıyaslama</h4>
            <p className="text-[11px] text-slate-400">Yalnızca Quant vs (Quant + JEV) Performans Ölçümü</p>
          </div>
        </div>
        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          Alpha Katkısı: +{ab.jevAlphaScore.toFixed(2)} USDT
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Branch A: Quant Only */}
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">Yol A: YALNIZCA QUANT</span>
            <span className="text-[10px] text-slate-400 font-mono">{ab.pathAQuantOnlyTrades} İşlem</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs pt-1">
            <div>
              <span className="text-slate-500 block text-[10px]">Kazanma Oranı</span>
              <span className="font-mono font-bold text-slate-300">%{ab.pathAWinRate.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Net P&L</span>
              <span className="font-mono font-bold text-emerald-400">+{ab.pathANetPnL.toFixed(2)} USDT</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Max Drawdown</span>
              <span className="font-mono font-bold text-rose-400">-%{ab.pathAMaxDrawdown.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Branch B: Quant + JEV */}
        <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-300">Yol B: QUANT + JEV SUPERVISOR</span>
            <span className="text-[10px] text-indigo-400 font-mono">{ab.pathBQuantJevTrades} İşlem</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs pt-1">
            <div>
              <span className="text-slate-500 block text-[10px]">Kazanma Oranı</span>
              <span className="font-mono font-bold text-emerald-400">%{ab.pathBWinRate.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Net P&L</span>
              <span className="font-mono font-bold text-emerald-400">+{ab.pathBNetPnL.toFixed(2)} USDT</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Max Drawdown</span>
              <span className="font-mono font-bold text-emerald-400">-%{ab.pathBMaxDrawdown.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* JEV Veto Insights */}
      <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          <span className="text-slate-300">
            JEV tarafından veto edilen <strong className="text-white">{ab.jevVetoedCount} işlem</strong> sayesinde önlenen kayıp:
          </span>
        </div>
        <span className="font-mono font-bold text-emerald-400">
          +{Math.abs(ab.jevVetoedHypotheticalPnL).toFixed(2)} USDT Korundu
        </span>
      </div>
    </div>
  );
}
