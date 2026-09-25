'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp,
  Cpu,
  Layers,
  Settings,
  RefreshCw,
  ShieldCheck,
  HelpCircle,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  DollarSign,
  Wallet,
  Sliders,
  Check,
  X,
  Play,
  Square,
  BarChart3,
  Bot
} from 'lucide-react';
import { ExchangeType, MarketData, AccountInfo, AIAnalysisResult, TradeOrder } from '@/types/trading';

const NASDAQ_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'QQQ', 'AMZN'];
const BINANCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

export default function TradingDashboard() {
  const [exchange, setExchange] = useState<ExchangeType>('nasdaq');
  const [symbol, setSymbol] = useState<string>('AAPL');
  
  // Market & Account Data
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [activeTableTab, setActiveTableTab] = useState<'positions' | 'orders'>('positions');

  // AI Engine Choice: Gemini vs Jev
  const [aiEngine, setAiEngine] = useState<'gemini' | 'jev'>('jev');
  const [strategy, setStrategy] = useState<string>('momentum');
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Continuous Auto-Trading Bot Loop (Sürekli Otomatik Al-Sat Döngüsü)
  const [isBotRunning, setIsBotRunning] = useState<boolean>(false);
  const [botIntervalSec, setBotIntervalSec] = useState<number>(15);
  const [botCountdown, setBotCountdown] = useState<number>(15);
  const [initialEquity, setInitialEquity] = useState<number | null>(null);
  const [botLogs, setBotLogs] = useState<{ time: string; msg: string; type: 'info' | 'buy' | 'sell' | 'hold' }[]>([]);

  // Manual Trading
  const [orderQuantity, setOrderQuantity] = useState<string>('5');
  const [isTrading, setIsTrading] = useState<boolean>(false);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);

  // Settings & Modals
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [isLoadingMarket, setIsLoadingMarket] = useState<boolean>(false);

  // API Keys (saved in localStorage for client testing)
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [jevKey, setJevKey] = useState<string>('');
  const [alpacaKey, setAlpacaKey] = useState<string>('');
  const [alpacaSecret, setAlpacaSecret] = useState<string>('');
  const [binanceKey, setBinanceKey] = useState<string>('');
  const [binanceSecret, setBinanceSecret] = useState<string>('');

  // Load saved keys from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setGeminiKey(localStorage.getItem('gemini_api_key') || '');
      setJevKey(localStorage.getItem('jev_api_key') || '');
      setAlpacaKey(localStorage.getItem('alpaca_api_key') || '');
      setAlpacaSecret(localStorage.getItem('alpaca_api_secret') || '');
      setBinanceKey(localStorage.getItem('binance_api_key') || '');
      setBinanceSecret(localStorage.getItem('binance_api_secret') || '');
    }
  }, []);

  const saveKeysToStorage = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('gemini_api_key', geminiKey);
      localStorage.setItem('jev_api_key', jevKey);
      localStorage.setItem('alpaca_api_key', alpacaKey);
      localStorage.setItem('alpaca_api_secret', alpacaSecret);
      localStorage.setItem('binance_api_key', binanceKey);
      localStorage.setItem('binance_api_secret', binanceSecret);
    }
    setShowSettings(false);
    fetchAccountData();
    fetchMarketData(symbol);
  };

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    if (geminiKey) headers['x-gemini-key'] = geminiKey;
    if (jevKey) headers['x-jev-key'] = jevKey;
    if (exchange === 'nasdaq') {
      if (alpacaKey) headers['x-alpaca-key'] = alpacaKey;
      if (alpacaSecret) headers['x-alpaca-secret'] = alpacaSecret;
    } else {
      if (binanceKey) headers['x-binance-key'] = binanceKey;
      if (binanceSecret) headers['x-binance-secret'] = binanceSecret;
    }
    return headers;
  }, [exchange, geminiKey, jevKey, alpacaKey, alpacaSecret, binanceKey, binanceSecret]);

  // Fetch Market Data
  const fetchMarketData = useCallback(async (sym: string) => {
    setIsLoadingMarket(true);
    try {
      const endpoint = exchange === 'nasdaq' ? '/api/nasdaq/market' : '/api/binance/market';
      const res = await fetch(`${endpoint}?symbol=${sym}`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setMarketData(data);
        return data;
      }
    } catch (err) {
      console.error('Failed to load market data', err);
    } finally {
      setIsLoadingMarket(false);
    }
    return null;
  }, [exchange, getHeaders]);

  // Fetch Account & Positions
  const fetchAccountData = useCallback(async () => {
    try {
      const endpoint = exchange === 'nasdaq' ? '/api/nasdaq/account' : '/api/binance/account';
      const res = await fetch(endpoint, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setAccount(data);
        setInitialEquity((prev) => (prev === null && data.equity ? data.equity : prev));
        if (data.orders) {
          setOrders(data.orders);
        }
      }
    } catch (err) {
      console.error('Failed to load account data', err);
    }
  }, [exchange, getHeaders]);

  // Tab change
  const handleTabChange = (newExchange: ExchangeType) => {
    setExchange(newExchange);
    const newSymbol = newExchange === 'nasdaq' ? 'AAPL' : 'BTCUSDT';
    setSymbol(newSymbol);
    setOrderQuantity(newExchange === 'nasdaq' ? '5' : '0.00003');
    setAiAnalysis(null);
    setInitialEquity(null);
  };

  const handleResetBinanceBalance = async () => {
    try {
      const res = await fetch('/api/binance/account', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAccount(data);
        setInitialEquity(10.0);
        setOrders([]);
        setTradeNotice('Binance bakiyesi başarıyla 10.00 USDT olarak sıfırlandı.');
        setTimeout(() => setTradeNotice(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMarketData(symbol);
    fetchAccountData();
    const interval = setInterval(() => {
      fetchMarketData(symbol);
      fetchAccountData();
    }, 15000);
    return () => clearInterval(interval);
  }, [exchange, symbol, fetchMarketData, fetchAccountData]);

  // Execute AI Analysis
  const runAIAnalysis = async (currentMkt?: MarketData) => {
    const targetMkt = currentMkt || marketData;
    if (!targetMkt) return null;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getHeaders(),
        },
        body: JSON.stringify({
          exchange,
          marketData: targetMkt,
          strategy,
          aiEngine,
        }),
      });

      if (res.ok) {
        const analysis: AIAnalysisResult = await res.json();
        setAiAnalysis(analysis);
        return analysis;
      }
    } catch (err) {
      console.error('AI Analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
    }
    return null;
  };

  // Execute Order
  const handleExecuteOrder = async (side: 'BUY' | 'SELL', qty: number, executedBy: 'AI' | 'MANUAL' = 'MANUAL') => {
    if (!marketData || qty <= 0) return;
    setIsTrading(true);
    try {
      const endpoint = exchange === 'nasdaq' ? '/api/nasdaq/trade' : '/api/binance/trade';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getHeaders(),
        },
        body: JSON.stringify({
          symbol: marketData.symbol,
          side,
          quantity: qty,
          executedBy,
        }),
      });

      if (res.ok) {
        const newOrder = await res.json();
        setOrders((prev) => [newOrder, ...prev]);
        setTradeNotice(`Başarılı: ${side} ${qty} ${marketData.symbol} emri iletildi.`);
        fetchAccountData();
        setTimeout(() => setTradeNotice(null), 5000);
      } else {
        const err = await res.json();
        setTradeNotice(`Hata: ${err.error || 'İşlem başarısız'}`);
        setTimeout(() => setTradeNotice(null), 5000);
      }
    } catch (err) {
      console.error('Trade failed:', err);
      setTradeNotice('Bağlantı hatası oluştu');
      setTimeout(() => setTradeNotice(null), 5000);
    } finally {
      setIsTrading(false);
    }
  };

  // Continuous Auto-Trading Bot Loop
  useEffect(() => {
    if (!isBotRunning) {
      setBotCountdown(botIntervalSec);
      return;
    }

    const intervalTimer = setInterval(async () => {
      setBotCountdown((prev) => {
        if (prev <= 1) {
          (async () => {
            const mkt = await fetchMarketData(symbol);
            if (mkt) {
              const analysis = await runAIAnalysis(mkt);
              if (analysis) {
                const now = new Date().toLocaleTimeString();
                if (analysis.action === 'BUY' && analysis.confidence >= 70) {
                  setBotLogs((l) => [{ time: now, msg: `${mkt.symbol} -> ALIM Emri (${analysis.suggestedQuantity} adet, %${analysis.confidence} güven)`, type: 'buy' }, ...l.slice(0, 19)]);
                  await handleExecuteOrder('BUY', analysis.suggestedQuantity, 'AI');
                } else if (analysis.action === 'SELL' && analysis.confidence >= 70) {
                  setBotLogs((l) => [{ time: now, msg: `${mkt.symbol} -> SATIŞ Emri (${analysis.suggestedQuantity} adet, %${analysis.confidence} güven)`, type: 'sell' }, ...l.slice(0, 19)]);
                  await handleExecuteOrder('SELL', analysis.suggestedQuantity, 'AI');
                } else {
                  setBotLogs((l) => [{ time: now, msg: `${mkt.symbol} -> BEKLE (Pozisyon korundu, güven: %${analysis.confidence})`, type: 'hold' }, ...l.slice(0, 19)]);
                }
              }
            }
          })();
          return botIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalTimer);
  }, [isBotRunning, botIntervalSec, symbol, fetchMarketData]);

  const currencySymbol = exchange === 'nasdaq' ? '$' : 'USDT ';
  const currentSymbols = exchange === 'nasdaq' ? NASDAQ_SYMBOLS : BINANCE_SYMBOLS;

  // Realized Net Profit Calculation
  const currentEquity = account?.equity || 0;
  const netPnL = initialEquity ? currentEquity - initialEquity : 0;
  const netPnLPct = initialEquity && initialEquity > 0 ? (netPnL / initialEquity) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#0f141f]/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-wide bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                QuantGemini & Jev Terminal
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                {aiEngine === 'jev' ? '⚡ TypeSafe Jev' : '🧠 Gemini 1.5'}
              </span>
            </div>
            <p className="text-xs text-slate-400">Nasdaq Paper & Binance Testnet Dual Engine</p>
          </div>
        </div>

        {/* Exchange Switcher Tabs */}
        <div className="flex items-center bg-[#070a0f] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => handleTabChange('nasdaq')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              exchange === 'nasdaq'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Nasdaq (Alpaca Paper)</span>
          </button>

          <button
            onClick={() => handleTabChange('binance')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              exchange === 'binance'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Binance (Spot Testnet)</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              fetchMarketData(symbol);
              fetchAccountData();
            }}
            title="Yenile"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingMarket ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>API & Bot Rehberi</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600/10 border border-indigo-500/30 text-xs font-medium text-indigo-300 hover:bg-indigo-600/20 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>API Ayarları</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (8 cols): Market, Charts, Positions */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Account Metrics Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Toplam Bakiye (Equity)</span>
                <Wallet className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-xl font-bold tracking-tight text-white flex items-baseline justify-between">
                <span>{account ? `${currencySymbol}${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '...'}</span>
                {exchange === 'binance' && (
                  <button
                    onClick={handleResetBinanceBalance}
                    title="Bakiyeyi $10'a Sıfırla"
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded font-normal"
                  >
                    10$&apos;a Sıfırla
                  </button>
                )}
              </div>
              <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                <span>{account?.isDemo ? '10$ Sandbox Modu' : 'Canlı Testnet'}</span>
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Nakit / Alım Gücü</span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xl font-bold tracking-tight text-white">
                {account ? `${currencySymbol}${account.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '...'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Kullanılabilir Nakit</div>
            </div>

            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Net Kar / Zarar (Bot PnL)</span>
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className={`text-xl font-bold tracking-tight ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netPnL >= 0 ? '+' : ''}{currencySymbol}{netPnL.toFixed(2)} ({netPnL >= 0 ? '+' : ''}{netPnLPct.toFixed(2)}%)
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {initialEquity ? `Başlangıç: ${currencySymbol}${initialEquity.toFixed(2)}` : 'Hesaplanıyor...'}
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Otomatik Bot Durumu</span>
                <Bot className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${isBotRunning ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`}>
                  {isBotRunning ? `BOT AKTİF (${botCountdown}s)` : 'DURDURULDU'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {orders.filter(o => o.executedBy === 'AI').length} AI Emri Verildi
              </div>
            </div>
          </div>

          {/* Symbol Selectors & Price Display Card */}
          <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-5 shadow-lg flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-400 mr-1">Hızlı Sembol:</span>
                {currentSymbols.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSymbol(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wider transition ${
                      symbol === s
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Sembol..."
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white uppercase focus:outline-none focus:border-indigo-500 w-28"
                />
              </div>
            </div>

            {/* Price Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight text-white">{marketData?.symbol || symbol}</h1>
                  <span className="text-[11px] font-medium text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                    {exchange === 'nasdaq' ? 'Nasdaq Stock' : 'Crypto Spot'}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="text-3xl font-extrabold tracking-tight text-white">
                    {currencySymbol}{marketData ? marketData.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '---'}
                  </span>
                  {marketData && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded ${
                        marketData.changePercent24h >= 0
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {marketData.changePercent24h >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {marketData.changePercent24h >= 0 ? '+' : ''}{marketData.changePercent24h.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>

              {/* 24h Stats */}
              <div className="grid grid-cols-3 gap-4 text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">24s En Yüksek</span>
                  <span className="font-semibold text-slate-200">
                    {currencySymbol}{marketData?.high24h.toFixed(2) || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">24s En Düşük</span>
                  <span className="font-semibold text-slate-200">
                    {currencySymbol}{marketData?.low24h.toFixed(2) || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">24s Hacim</span>
                  <span className="font-semibold text-slate-200">
                    {marketData ? marketData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '---'}
                  </span>
                </div>
              </div>
            </div>

            {/* Sparkline / History Visualizer */}
            {marketData?.history && marketData.history.length > 0 && (
              <div className="mt-2 pt-4 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                  <span>24 Saatlik Fiyat Eğrisi (Saatlik Barlar)</span>
                  <span className="text-indigo-400 font-mono">Canlı Akış</span>
                </div>
                <div className="h-28 w-full flex items-end gap-1.5 pt-2">
                  {(() => {
                    const prices = marketData.history.map((h) => h.price);
                    const min = Math.min(...prices);
                    const max = Math.max(...prices);
                    const range = max - min || 1;

                    return marketData.history.map((item, idx) => {
                      const heightPercent = Math.max(15, Math.min(100, Math.round(((item.price - min) / range) * 85 + 15)));
                      const isUp = idx > 0 ? item.price >= marketData.history![idx - 1].price : true;
                      return (
                        <div
                          key={idx}
                          className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end"
                        >
                          <div
                            style={{ height: `${heightPercent}%` }}
                            className={`w-full rounded-t-sm transition-all duration-300 ${
                              isUp ? 'bg-emerald-500/70 group-hover:bg-emerald-400' : 'bg-rose-500/70 group-hover:bg-rose-400'
                            }`}
                          />
                          <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                            <div className="bg-slate-900 border border-slate-700 text-[10px] px-2 py-1 rounded shadow-xl text-white whitespace-nowrap">
                              {item.time}: {currencySymbol}{item.price.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Positions & Orders Table */}
          <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTableTab('positions')}
                  className={`text-xs font-bold pb-2 transition border-b-2 ${
                    activeTableTab === 'positions'
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Açık Pozisyonlar ({account?.positions.length || 0})
                </button>
                <button
                  onClick={() => setActiveTableTab('orders')}
                  className={`text-xs font-bold pb-2 ml-4 transition border-b-2 ${
                    activeTableTab === 'orders'
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  İşlem Geçmişi ({orders.length})
                </button>
              </div>
              <span className="text-[11px] text-slate-400">
                {account?.statusMessage || 'Hazır'}
              </span>
            </div>

            {/* Positions Table */}
            {activeTableTab === 'positions' && (
              <div className="overflow-x-auto mt-3">
                {account?.positions && account.positions.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800/60 pb-2">
                        <th className="py-2.5 font-medium">Varlık</th>
                        <th className="py-2.5 font-medium">Miktar</th>
                        <th className="py-2.5 font-medium">Giriş Fiyatı</th>
                        <th className="py-2.5 font-medium">Piyasa Değeri</th>
                        <th className="py-2.5 font-medium">Kar / Zarar (P&L)</th>
                        <th className="py-2.5 font-medium text-right">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {account.positions.map((pos) => {
                        const isProfitable = pos.unrealizedPl >= 0;
                        return (
                          <tr key={pos.symbol} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 font-semibold text-white">{pos.symbol}</td>
                            <td className="py-3 text-slate-300 font-mono">{pos.quantity}</td>
                            <td className="py-3 text-slate-300">{currencySymbol}{pos.entryPrice.toFixed(2)}</td>
                            <td className="py-3 text-slate-300">{currencySymbol}{pos.marketValue.toFixed(2)}</td>
                            <td className="py-3 font-medium">
                              <span className={isProfitable ? 'text-emerald-400' : 'text-rose-400'}>
                                {isProfitable ? '+' : ''}{currencySymbol}{pos.unrealizedPl.toFixed(2)} ({isProfitable ? '+' : ''}{pos.unrealizedPlPercent.toFixed(2)}%)
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <button
                                onClick={() => handleExecuteOrder('SELL', pos.quantity, 'MANUAL')}
                                disabled={isTrading}
                                className="px-2.5 py-1 rounded bg-rose-600/20 border border-rose-500/30 text-rose-300 text-[11px] font-semibold hover:bg-rose-600/30 transition"
                              >
                                Kapat / Sat
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    Henüz açık pozisyon bulunmuyor. AI botunu başlatarak veya manuel alım yaparak pozisyon açabilirsiniz.
                  </div>
                )}
              </div>
            )}

            {/* Orders Table */}
            {activeTableTab === 'orders' && (
              <div className="overflow-x-auto mt-3">
                {orders.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800/60 pb-2">
                        <th className="py-2.5 font-medium">Zaman</th>
                        <th className="py-2.5 font-medium">Sembol</th>
                        <th className="py-2.5 font-medium">Tür</th>
                        <th className="py-2.5 font-medium">Miktar</th>
                        <th className="py-2.5 font-medium">Fiyat</th>
                        <th className="py-2.5 font-medium">Kaynak</th>
                        <th className="py-2.5 font-medium text-right">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {orders.map((ord) => (
                        <tr key={ord.id} className="hover:bg-slate-800/30 transition">
                          <td className="py-2.5 text-slate-400 text-[11px]">
                            {new Date(ord.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 font-semibold text-white">{ord.symbol}</td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                ord.side === 'BUY'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {ord.side}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-slate-200">{ord.quantity}</td>
                          <td className="py-2.5 text-slate-300">{currencySymbol}{ord.price.toFixed(2)}</td>
                          <td className="py-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                              {ord.executedBy === 'AI' ? (
                                <>
                                  <Sparkles className="w-3 h-3 text-indigo-400" />
                                  <span className="text-indigo-300">AI Bot</span>
                                </>
                              ) : (
                                <span>Kullanıcı</span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="text-emerald-400 font-medium text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded">
                              {ord.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    Henüz işlem kaydı yok.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (4 cols): AI Decision Engine & Continuous Auto-Trading Bot */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Continuous Auto-Trading Bot Panel */}
          <div className="bg-[#121824] border border-cyan-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-400 animate-pulse" />
                <span className="font-bold text-sm text-white">Sürekli Al-Sat Botu</span>
              </div>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${isBotRunning ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                {isBotRunning ? 'ÇALIŞIYOR' : 'DURDU'}
              </span>
            </div>

            <p className="text-xs text-slate-300">
              Bot her <strong>{botIntervalSec} saniyede bir</strong> piyasa verisini {aiEngine.toUpperCase()} modeline gönderir, %70 üzeri güven sinyallerinde otomatik al/sat yapar ve kârlılığı ölçer.
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Döngü Süresi</label>
                <select
                  value={botIntervalSec}
                  onChange={(e) => setBotIntervalSec(Number(e.target.value))}
                  disabled={isBotRunning}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value={10}>10 Saniyede bir (Hızlı)</option>
                  <option value={15}>15 Saniyede bir (Standart)</option>
                  <option value={30}>30 Saniyede bir</option>
                  <option value={60}>60 Saniyede bir (1 Dakika)</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">AI Motoru</label>
                <select
                  value={aiEngine}
                  onChange={(e) => setAiEngine(e.target.value as 'gemini' | 'jev')}
                  disabled={isBotRunning}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="jev">⚡ TypeSafe Jev (Hızlı)</option>
                  <option value="gemini">🧠 Gemini 1.5 Flash</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                if (!isBotRunning && account) {
                  setInitialEquity(account.equity);
                }
                setIsBotRunning(!isBotRunning);
              }}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition ${
                isBotRunning
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/30'
              }`}
            >
              {isBotRunning ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Botu Durdur ({botCountdown}s kaldı)</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Sürekli Otomatik Al-Sat Başlat</span>
                </>
              )}
            </button>

            {/* Real-time Bot Log Stream */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
              <span className="text-slate-400 text-[10px] uppercase font-bold pb-1 border-b border-slate-800">
                Canlı Bot Log Akışı
              </span>
              {botLogs.length > 0 ? (
                botLogs.map((log, i) => (
                  <div key={i} className="flex items-start gap-1.5 leading-tight">
                    <span className="text-slate-500 text-[10px] shrink-0">[{log.time}]</span>
                    <span
                      className={
                        log.type === 'buy'
                          ? 'text-emerald-400 font-semibold'
                          : log.type === 'sell'
                          ? 'text-rose-400 font-semibold'
                          : 'text-slate-300'
                      }
                    >
                      {log.msg}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-slate-400 text-center py-2">
                  Bot başlatıldığında al-sat kararları buraya akacaktır.
                </span>
              )}
            </div>
          </div>

          {/* AI Decision Single Analysis Box */}
          <div className="bg-[#121824] border border-indigo-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="font-bold text-sm text-white">Manuel AI Analizi</span>
              </div>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                {aiEngine === 'jev' ? 'TypeSafe Jev' : 'gemini-1.5-flash'}
              </span>
            </div>

            <button
              onClick={() => runAIAnalysis()}
              disabled={isAnalyzing || !marketData}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Piyasa Analiz Ediliyor...</span>
                </>
              ) : (
                <>
                  <Cpu className="w-4 h-4" />
                  <span>Tek Seferlik AI Analiz Et ({marketData?.symbol || symbol})</span>
                </>
              )}
            </button>

            {/* AI Decision Result Card */}
            {aiAnalysis ? (
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Üretilen Sinyal:</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-black tracking-wider ${
                        aiAnalysis.action === 'BUY'
                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                          : aiAnalysis.action === 'SELL'
                          ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                          : 'bg-amber-400 text-slate-950'
                      }`}
                    >
                      {aiAnalysis.action}
                    </span>
                    <span className="text-xs font-bold text-slate-300 font-mono">
                      %{aiAnalysis.confidence} Güven
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 leading-relaxed">
                  <p>{aiAnalysis.reasoning}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="bg-slate-800/50 p-2 rounded">
                    <span className="text-slate-400 block">Hedef Fiyat</span>
                    <span className="font-semibold text-emerald-400">{currencySymbol}{aiAnalysis.targetPrice}</span>
                  </div>
                  <div className="bg-slate-800/50 p-2 rounded">
                    <span className="text-slate-400 block">Stop Loss</span>
                    <span className="font-semibold text-rose-400">{currencySymbol}{aiAnalysis.stopLoss}</span>
                  </div>
                </div>

                {aiAnalysis.action !== 'HOLD' && (
                  <button
                    onClick={() => handleExecuteOrder(aiAnalysis.action as 'BUY' | 'SELL', aiAnalysis.suggestedQuantity, 'AI')}
                    disabled={isTrading}
                    className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      aiAnalysis.action === 'BUY'
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
                        : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Emri Uygula ({aiAnalysis.action} {aiAnalysis.suggestedQuantity} Adet)</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400">
                Analiz sonucu burada görüntülenecektir.
              </div>
            )}
          </div>

          {/* Manual Trade Order Box */}
          <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Manuel Testnet Emri Ver</span>
            </h3>

            {tradeNotice && (
              <div className="text-xs p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
                {tradeNotice}
              </div>
            )}

            <div>
              <label className="text-xs text-slate-400 block mb-1">Miktar ({marketData?.symbol || symbol})</label>
              <input
                type="number"
                step="any"
                value={orderQuantity}
                onChange={(e) => setOrderQuantity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => handleExecuteOrder('BUY', Number(orderQuantity), 'MANUAL')}
                disabled={isTrading || Number(orderQuantity) <= 0}
                className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>ALIM (BUY)</span>
              </button>

              <button
                onClick={() => handleExecuteOrder('SELL', Number(orderQuantity), 'MANUAL')}
                disabled={isTrading || Number(orderQuantity) <= 0}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 transition disabled:opacity-50"
              >
                <ArrowDownRight className="w-4 h-4" />
                <span>SATIŞ (SELL)</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" />
                <span>API Anahtarları Yapılandırması</span>
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Anahtarlarınız tarayıcı yerel hafızasında saklanır. Vercel deployment&apos;ı için Environment Variables bölümüne de ekleyebilirsiniz.
            </p>

            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">TypeSafe Jev API Key (System One)</label>
                <input
                  type="password"
                  value={jevKey}
                  onChange={(e) => setJevKey(e.target.value)}
                  placeholder="ts_live_..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Google Gemini API Key</label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div className="pt-2 border-t border-slate-800">
                <h4 className="text-indigo-400 font-semibold mb-2">Alpaca Paper Trading (Nasdaq)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">API Key ID</label>
                    <input
                      type="text"
                      value={alpacaKey}
                      onChange={(e) => setAlpacaKey(e.target.value)}
                      placeholder="PK..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">API Secret Key</label>
                    <input
                      type="password"
                      value={alpacaSecret}
                      onChange={(e) => setAlpacaSecret(e.target.value)}
                      placeholder="Secret..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800">
                <h4 className="text-amber-400 font-semibold mb-2">Binance Spot Testnet (Kripto)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Binance API Key</label>
                    <input
                      type="text"
                      value={binanceKey}
                      onChange={(e) => setBinanceKey(e.target.value)}
                      placeholder="Key..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Binance API Secret</label>
                    <input
                      type="password"
                      value={binanceSecret}
                      onChange={(e) => setBinanceSecret(e.target.value)}
                      placeholder="Secret..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
              >
                İptal
              </button>
              <button
                onClick={saveKeysToStorage}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition"
              >
                Kaydet ve Uygula
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-cyan-400" />
                <span>API Anahtarları & Bot Nasıl Çalışır?</span>
              </h2>
              <button onClick={() => setShowGuide(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                <h4 className="font-bold text-cyan-400 mb-1">1. TypeSafe Jev API Nedir ve Nasıl Alınır?</h4>
                <p>
                  <strong>TypeSafe Jev</strong> (OpenAI eski araştırmacısı Diogo Almeida tarafından geliştirilen), metin üretmek yerine milisaniyeler (70-100ms) içinde doğrudan kalibre edilmiş olasılıklarla al/sat kararı üreten bir System-1 karar motorudur. <strong>typesafe.ai</strong> üzerinden API erişimi alınabilir.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                <h4 className="font-bold text-blue-400 mb-1">2. Alpaca Paper Trading ($100,000 Sanal Nasdaq)</h4>
                <p>
                  1. <strong>app.alpaca.markets</strong> adresinde ücretsiz hesap oluşturun.<br/>
                  2. Sol menüde &apos;Live Trading&apos; yerine <strong>Paper Trading</strong> seçin.<br/>
                  3. Dashboard&apos;daki &apos;API Keys&apos; bölümünden <strong>Generate New Key</strong> yapın. Anında $100k sanal bakiye tanımlanır.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                <h4 className="font-bold text-amber-400 mb-1">3. Binance Spot Testnet (Sanal Kripto)</h4>
                <p>
                  1. <strong>testnet.binance.vision</strong> adresini açın.<br/>
                  2. <strong>Log In with GitHub</strong> ile tek tıkla giriş yapın.<br/>
                  3. <strong>Generate HMAC_SHA256 Key</strong> butonuna basarak API Key ve Secret Key alın.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                <h4 className="font-bold text-emerald-400 mb-1">4. Sürekli Al-Sat Botu ve Kârlılık Takibi</h4>
                <p>
                  Bot aktif edildiğinde seçtiğiniz periyotta (örn: 15s) fiyatları okur, modeli çağırır ve uygun fırsat bulduğunda testnet üzerinden pozisyon açar/kapatır. Üst bardaki <strong>Net Kar / Zarar (Bot PnL)</strong> kutusundan botun kâra geçip geçmediğini anlık takip edebilirsiniz.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowGuide(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
