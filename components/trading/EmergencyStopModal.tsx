'use client';

import React, { useState } from 'react';
import { EmergencyAction } from '@/lib/core/types';
import { AlertOctagon, X, ShieldAlert, Check, RefreshCw } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onActionComplete: (msg: string) => void;
}

export function EmergencyStopModal({ isOpen, onClose, onActionComplete }: Props) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerAction = async (action: EmergencyAction, confirmation: boolean = false) => {
    setLoadingAction(action);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/trading/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, confirmation }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'İşlem başarısız oldu');
      }
      onActionComplete(data.message || 'Acil durdurma başarıyla yürütüldü.');
      setConfirmFlatten(false);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#121824] border border-rose-500/40 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-200">
        <div className="p-5 border-b border-rose-500/30 flex items-center justify-between bg-rose-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <AlertOctagon className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Acil Durdurma Kontrol Paneli</h3>
              <p className="text-xs text-rose-300/80">Kritik Risk Durdurma ve Güvenlik Mekanizması</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Action 1: Stop New Entries */}
          <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition">
            <div>
              <div className="font-semibold text-sm text-white">Yeni Emirleri Durdur (STOP_NEW_ENTRIES)</div>
              <div className="text-xs text-slate-400">Mevcut açık pozisyonlar ve SL/TP limitleri korunur, yeni pozisyon açılmaz.</div>
            </div>
            <button
              onClick={() => triggerAction('STOP_NEW_ENTRIES')}
              disabled={loadingAction !== null}
              className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg font-bold text-xs transition"
            >
              {loadingAction === 'STOP_NEW_ENTRIES' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Durdur'}
            </button>
          </div>

          {/* Action 2: Cancel All Open Orders */}
          <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition">
            <div>
              <div className="font-semibold text-sm text-white">Tüm Açık Emirleri İptal Et (CANCEL_ALL_OPEN_ORDERS)</div>
              <div className="text-xs text-slate-400">Bekleyen tüm limit ve tetikleme emirlerini borsadan siler.</div>
            </div>
            <button
              onClick={() => triggerAction('CANCEL_ALL_OPEN_ORDERS')}
              disabled={loadingAction !== null}
              className="px-4 py-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded-lg font-bold text-xs transition"
            >
              {loadingAction === 'CANCEL_ALL_OPEN_ORDERS' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Emirleri İptal Et'}
            </button>
          </div>

          {/* Action 3: Flatten Positions */}
          <div className="p-4 bg-rose-950/20 border border-rose-900/50 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-rose-300">Tüm Pozisyonları Kapat (FLATTEN_POSITIONS)</div>
                <div className="text-xs text-slate-400">Tüm açık varlıkları anında piyasa fiyatından satarak nakite geçer.</div>
              </div>
            </div>

            {!confirmFlatten ? (
              <button
                onClick={() => setConfirmFlatten(true)}
                className="w-full py-2.5 bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/50 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition"
              >
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Pozisyonları Kapatmayı Başlat
              </button>
            ) : (
              <div className="p-3 bg-rose-900/40 border border-rose-700 rounded-lg space-y-2">
                <div className="text-xs font-semibold text-rose-200">
                  ⚠️ DİKKAT: Bu işlem tüm açık varlıklarınızı anında satar. Onaylıyor musunuz?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => triggerAction('FLATTEN_POSITIONS', true)}
                    disabled={loadingAction !== null}
                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold text-xs transition flex items-center justify-center gap-1"
                  >
                    {loadingAction === 'FLATTEN_POSITIONS' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Evet, Hepsini Tasfiye Et'}
                  </button>
                  <button
                    onClick={() => setConfirmFlatten(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold text-xs transition"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-900 border-t border-slate-800 text-center">
          <p className="text-[11px] text-slate-500">
            Acil durdurma kuralları Hard Risk Engine tarafından sunucu seviyesinde kilitlenir.
          </p>
        </div>
      </div>
    </div>
  );
}
