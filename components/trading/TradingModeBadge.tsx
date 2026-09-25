'use client';

import React from 'react';
import { TradingMode } from '@/lib/core/types';
import { ShieldAlert, ShieldCheck, Cpu, AlertTriangle } from 'lucide-react';

interface Props {
  mode: TradingMode;
  onModeChange?: (newMode: TradingMode) => void;
  isLiveAllowed?: boolean;
}

export function TradingModeBadge({ mode, onModeChange, isLiveAllowed = false }: Props) {
  const getBadgeStyle = () => {
    switch (mode) {
      case 'LIVE':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-rose-950/50';
      case 'BINANCE_TESTNET':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-950/50';
      case 'ALPACA_PAPER':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-cyan-950/50';
      case 'LOCAL_SIM':
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-950/50';
    }
  };

  const getLabel = () => {
    switch (mode) {
      case 'LIVE':
        return '🔴 LIVE MONEY (REAL CAPITAL)';
      case 'BINANCE_TESTNET':
        return '🟡 BINANCE TESTNET';
      case 'ALPACA_PAPER':
        return '🔵 ALPACA PAPER';
      case 'LOCAL_SIM':
      default:
        return '🟢 LOCAL SIMULATION (REAL MARKET DATA)';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`px-3 py-1 rounded-lg border text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-sm ${getBadgeStyle()}`}
      >
        {mode === 'LIVE' ? (
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        )}
        <span>{getLabel()}</span>
      </div>

      {mode === 'LIVE' && (
        <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-950/50 border border-rose-800/60 px-2 py-0.5 rounded">
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          CANLI PARA KULLANILIYOR
        </span>
      )}
    </div>
  );
}
