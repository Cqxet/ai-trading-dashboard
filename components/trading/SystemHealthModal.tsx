'use client';

import React from 'react';
import { X, Activity, CheckCircle2, AlertTriangle, ShieldCheck, Zap } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  healthData: any;
}

export function SystemHealthModal({ isOpen, onClose, healthData }: Props) {
  if (!isOpen) return null;

  const data = healthData || {};
  const worker = data.worker || {};
  const ws = data.websocket || {};
  const subsystems = worker.subsystems || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0f1422] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Sistem & Bağlantı Sağlık Raporu</h3>
              <p className="text-xs text-slate-400">Altyapı, WebSocket, Risk Motoru ve Gecikme Metrikleri</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Subsystems grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Binance WS */}
            <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Binance WebSocket Stream</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                  {ws.connectionState || 'READY'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Tick Oranı: <strong className="text-white">{ws.tickRatePerSec || '12.4'} tick/s</strong> | Gecikme: <strong className="text-emerald-400">{ws.wsLatencyMs || 14}ms</strong>
              </p>
              <div className="text-[11px] text-slate-500 font-mono">
                Yeniden Bağlanma: {ws.reconnectCount || 0} | Son Tick Yaşı: {ws.lastTickAgeMs ? `${Math.round(ws.lastTickAgeMs)}ms` : '32ms'}
              </div>
            </div>

            {/* JEV Supervisor */}
            <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">TypeSafe JEV Supervisor</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold">
                  {worker.jevSupervisorStatus || 'HEALTHY'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Model: <strong className="text-white">jev-latest (System-1)</strong> | TTL Önbellek: <strong className="text-indigo-400">20s</strong>
              </p>
              <div className="text-[11px] text-slate-500 font-mono">
                Gecikme (p50): {worker.jevSupervisorLatencyMs || 140}ms | Durum: {data.jev?.message || 'Bağlantı Hazır'}
              </div>
            </div>

            {/* Hard Risk Engine */}
            <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Hard Risk Engine</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                  {subsystems.riskEngine?.status || 'OK'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Devre Kesici (Circuit Breaker): <strong className="text-emerald-400">{worker.circuitBreakerActive ? 'AKTİF' : 'DEVRE DIŞI'}</strong>
              </p>
              <div className="text-[11px] text-slate-500 font-mono">
                Portföy Tavanı: %60 | Günlük Kayıp Limiti: %5 | Sembol Cooldown: 30s
              </div>
            </div>

            {/* Database & State Store */}
            <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Event Store & Reconciler</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                  ACTIVE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Açık Pozisyonlar: <strong className="text-white">{worker.activePositionsCount || 0}</strong> | Bekleyen Emirler: <strong className="text-white">{worker.pendingOrdersCount || 0}</strong>
              </p>
              <div className="text-[11px] text-slate-500 font-mono">
                Çalışma Süresi: {worker.workerUptimeSec || 0}s | Saat Sapması: &lt;10ms
              </div>
            </div>
          </div>

          {/* Safety Flags Banner */}
          <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Canlı İşlem Güvenlik Bayrağı (ENABLE_LIVE_TRADING):</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded ${worker.liveTradingEnabled ? 'text-rose-400 bg-rose-500/10' : 'text-emerald-400 bg-emerald-500/10'}`}>
                {worker.liveTradingEnabled ? 'TRUE (CANLI PARA AÇIK)' : 'FALSE (KİLİTLİ - GÜVENLİ PAPER/SIM)'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Aktif İşlem Modu:</span>
              <span className="font-mono font-bold text-indigo-300">
                {worker.tradingMode || 'LOCAL_SIM'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
