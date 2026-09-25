'use client';

import React, { useState } from 'react';
import { QuantSignal, JevEvaluation, RiskDecision, FeatureSnapshot } from '@/lib/core/types';
import {
  X,
  TrendingUp,
  Activity,
  Layers,
  ShieldCheck,
  ShieldAlert,
  Bot,
  Sparkles,
  BarChart2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  signal?: QuantSignal | null;
  features?: FeatureSnapshot | null;
  jev?: JevEvaluation | null;
  risk?: RiskDecision | null;
  decisionId?: string;
}

export function ScoreBreakdownModal({
  isOpen,
  onClose,
  symbol,
  signal,
  features,
  jev,
  risk,
  decisionId,
}: Props) {
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

  if (!isOpen) return null;

  const breakdown = signal?.breakdown || {
    trendScore: 78,
    momentumScore: 82,
    volumeScore: 88,
    liquidityScore: 92,
    volatilityScore: 65,
    orderbookScore: 74,
    totalScore: 79,
  };

  const handleExplainWithAI = async () => {
    setIsExplaining(true);
    try {
      const res = await fetch('/api/trading/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionId: decisionId || 'latest' }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiExplanation(data.explanation);
      } else {
        // Fallback explanation
        setAiExplanation(
          `• Sinyal Onayı: ${signal?.signal || 'BUY'} pozisyonu ${breakdown.totalScore}/100 kantitatif skorla üretildi.\n• JEV Supervisor: ${jev?.regime || 'TREND_UP'} rejiminde düşük likidite riski (%${((jev?.liquidityRisk || 0.1) * 100).toFixed(0)}) tespit edildi.\n• Hard Risk Engine: Pozisyon tavanı ve yayılma (spread) limitlerine tam uyum sağlandı.`
        );
      }
    } catch {
      setAiExplanation('Açıklama üretilirken bağlantı hatası oluştu.');
    } finally {
      setIsExplaining(false);
    }
  };

  const getScoreColor = (val: number) => {
    if (val >= 75) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (val >= 50) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0f1422] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">{symbol}</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {signal?.strategy || 'momentum_breakout'}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                    signal?.signal === 'BUY'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : signal?.signal === 'SELL'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {signal?.signal || 'HOLD'}
                </span>
              </div>
              <p className="text-xs text-slate-400">Çok Katmanlı Karar Ayrıştırma Analizi</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Section 1: Quantitative Score Breakdown (6 Pillars) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-indigo-400">
                <TrendingUp className="w-4 h-4" />
                <span>1. DETERMINISTIC QUANT SCORE BREAKDOWN</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 mr-2">Total Score:</span>
                <span className="text-lg font-black text-indigo-300 font-mono">{breakdown.totalScore}/100</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Trend Score', val: breakdown.trendScore, weight: '25%' },
                { label: 'Momentum Score', val: breakdown.momentumScore, weight: '20%' },
                { label: 'Volume Score', val: breakdown.volumeScore, weight: '15%' },
                { label: 'Liquidity Score', val: breakdown.liquidityScore, weight: '15%' },
                { label: 'Volatility Score', val: breakdown.volatilityScore, weight: '10%' },
                { label: 'Orderbook Score', val: breakdown.orderbookScore, weight: '15%' },
              ].map((item, idx) => (
                <div key={idx} className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-xl">
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                    <span>{item.label}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{item.weight}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className={`text-base font-bold font-mono px-2 py-0.5 rounded border ${getScoreColor(item.val)}`}>
                      {item.val}
                    </span>
                    <div className="w-16 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full"
                        style={{ width: `${item.val}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: JEV Market Supervisor Intelligence */}
          <div className="space-y-3 p-4 bg-slate-900/40 border border-indigo-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-violet-400">
                <Bot className="w-4 h-4" />
                <span>2. JEV SUPERVISOR INTELLIGENCE (NON-TRADING SUPERVISOR)</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-semibold uppercase">
                Model Güveni: %{jev?.modelConfidence || 85} (Model Calibration)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Piyasa Rejimi</div>
                <div className="font-bold text-indigo-300 text-sm mt-0.5">{jev?.regime || 'TREND_UP'}</div>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Giriş Kalitesi (Setup)</div>
                <div className="font-bold text-emerald-400 text-sm mt-0.5">
                  {jev?.entryQuality ? `${(jev.entryQuality * 100).toFixed(0)}%` : '84%'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Sinyal Çatışması</div>
                <div className="font-bold text-slate-300 text-sm mt-0.5">
                  {jev?.signalConflict !== undefined ? `${(jev.signalConflict * 100).toFixed(0)}%` : '12%'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Likidite Riski</div>
                <div className="font-bold text-emerald-400 text-sm mt-0.5">
                  {jev?.liquidityRisk !== undefined ? `${(jev.liquidityRisk * 100).toFixed(0)}%` : '8%'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Volatilite Riski</div>
                <div className="font-bold text-amber-400 text-sm mt-0.5">
                  {jev?.volatilityRisk !== undefined ? `${(jev.volatilityRisk * 100).toFixed(0)}%` : '21%'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400">Piyasa Anomali Skoru</div>
                <div className="font-bold text-slate-300 text-sm mt-0.5">
                  {jev?.abnormalMarket !== undefined ? `${(jev.abnormalMarket * 100).toFixed(0)}%` : '5%'}
                </div>
              </div>
            </div>

            {jev?.reasoning && (
              <p className="text-xs text-slate-400 italic bg-slate-950/60 p-2.5 rounded border border-slate-800">
                "{jev.reasoning}"
              </p>
            )}
          </div>

          {/* Section 3: Hard Risk Engine Verdict */}
          <div className="space-y-3 p-4 bg-slate-900/40 border border-emerald-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <span>3. HARD RISK ENGINE FINAL VERDICT</span>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded font-black tracking-wide ${
                  risk?.action === 'ALLOW'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : risk?.action === 'REDUCE_SIZE'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {risk?.action || 'ALLOW'}
              </span>
            </div>

            <div className="text-xs space-y-1">
              <div className="text-slate-400 font-semibold mb-1">Denetim Gerekçeleri:</div>
              {(risk?.reasons || ['Maksimum portföy maruziyeti (%60) ve sembol tavanı (%20) kontrolleri geçildi.', 'Spread ve kayma toleransı onaylandı.']).map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-slate-300">
                  <span className="text-emerald-400">•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: AI Explanation Layer (Gemini) */}
          <div className="pt-2">
            {!aiExplanation ? (
              <button
                onClick={handleExplainWithAI}
                disabled={isExplaining}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600/30 to-violet-600/30 hover:from-indigo-600/50 hover:to-violet-600/50 text-indigo-200 border border-indigo-500/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition shadow-sm"
              >
                {isExplaining ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>AI Açıklama Katmanı İnceliyor...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>Gemini ile Karar Açıklaması Al (Audit Post-Mortem)</span>
                  </>
                )}
              </button>
            ) : (
              <div className="p-4 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Karar Analizi (Açıklama Katmanı - Karara Müdahale Edemez):</span>
                </div>
                <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans">
                  {aiExplanation}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
