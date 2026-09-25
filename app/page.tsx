'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Cpu,
  Layers,
  Settings,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
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
  Bot,
  Activity
} from 'lucide-react';
import {
  ExchangeType,
  MarketData,
  AccountInfo,
  AIAnalysisResult,
  TradeOrder,
  SimulationWallet,
  SimulationPosition,
  SimulationTrade,
} from '@/types/trading';
import {
  loadSimulationWallet,
  saveSimulationWallet,
  recalculateWallet,
  executeSimulationBuy,
  executeSimulationSell,
  resetSimulationWallet,
  SIMULATION_WALLET_STORAGE_KEY,
} from '@/lib/simulationWallet';
import { scanBinanceMarkets, ScannedMarketCandidate, ScannerSummary } from '@/lib/services/marketScannerService';
import { evaluateTradeRisk, DEFAULT_RISK_LIMITS } from '@/lib/services/riskEngine';

const NASDAQ_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'QQQ', 'AMZN'];
const BINANCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'SUIUSDT',
  'NEARUSDT',
];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function TradingDashboard() {
  const [exchange, setExchange] = useState<ExchangeType>('binance');
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<string>('1h');

  // Market Data (100% Real from Mainnet / Live Data Feed)
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoadingMarket, setIsLoadingMarket] = useState<boolean>(true);
  const [marketError, setMarketError] = useState<string | null>(null);

  // Virtual Simulation Wallet (10.00 USDT Initial State & Persistence)
  const [simWallet, setSimWallet] = useState<SimulationWallet>(() => {
    return {
      version: 1,
      initialBalance: 10.0,
      cash: 10.0,
      equity: 10.0,
      realizedPnL: 0,
      positions: [],
      trades: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });
  const [symbolPrices, setSymbolPrices] = useState<Record<string, number>>({});
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  // Dynamic Multi-Asset Scanner & Risk Engine
  const [scannerSummary, setScannerSummary] = useState<ScannerSummary | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [currentTarget, setCurrentTarget] = useState<{
    symbol: string;
    mode: 'SPOT' | 'FUTURES';
    action: string;
    confidence: number;
    price: number;
    suggestedUsdt: number;
    leverage: number;
    reason: string;
  } | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(true);

  // Trading Account Data (For Nasdaq Alpaca Paper)
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [initialEquity, setInitialEquity] = useState<number | null>(null);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [activeTableTab, setActiveTableTab] = useState<'positions' | 'orders'>('positions');

  // AI Engine Choice: Jev vs Gemini
  const [aiEngine, setAiEngine] = useState<'jev' | 'gemini'>('jev');
  const [strategy, setStrategy] = useState<string>('momentum');
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Continuous Auto-Trading Bot Loop & JEV Settings
  const [isBotRunning, setIsBotRunning] = useState<boolean>(false);
  const [botIntervalSec, setBotIntervalSec] = useState<number>(15);
  const [botMinConfidence, setBotMinConfidence] = useState<number>(70);
  const [botTradeSizePct, setBotTradeSizePct] = useState<number>(10);
  const [botCooldownSec, setBotCooldownSec] = useState<number>(30);
  const [botCountdown, setBotCountdown] = useState<number>(15);
  const [botLogs, setBotLogs] = useState<{ time: string; msg: string; type: 'info' | 'buy' | 'sell' | 'hold' }[]>([]);
  const lastTradeTimeRef = React.useRef<number>(0);
  const simWalletRef = React.useRef<SimulationWallet>(simWallet);
  simWalletRef.current = simWallet;

  // Manual Trading (Default mode: USDT input)
  const [orderAmountUsdt, setOrderAmountUsdt] = useState<string>('1.00');
  const [orderQuantity, setOrderQuantity] = useState<string>('0.00003');
  const [isTrading, setIsTrading] = useState<boolean>(false);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);

  // Modals & Settings
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showHealth, setShowHealth] = useState<boolean>(false);
  const [healthData, setHealthData] = useState<any>(null);

  // API Keys (Stored locally for client testing, private server-side fallback used)
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [jevKey, setJevKey] = useState<string>('');
  const [alpacaKey, setAlpacaKey] = useState<string>('');
  const [alpacaSecret, setAlpacaSecret] = useState<string>('');
  const [binanceKey, setBinanceKey] = useState<string>('');
  const [binanceSecret, setBinanceSecret] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setGeminiKey(localStorage.getItem('gemini_api_key') || '');
      setJevKey(localStorage.getItem('jev_api_key') || '');
      setAlpacaKey(localStorage.getItem('alpaca_api_key') || '');
      setAlpacaSecret(localStorage.getItem('alpaca_api_secret') || '');
      setBinanceKey(localStorage.getItem('binance_api_key') || '');
      setBinanceSecret(localStorage.getItem('binance_api_secret') || '');

      // Load simulation wallet from localStorage
      const loaded = loadSimulationWallet();
      setSimWallet(loaded);
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
    fetchMarketData(symbol, timeframe);
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

  // Fetch 100% Real Market Data
  const fetchMarketData = useCallback(async (sym: string, tf: string = '1h') => {
    setIsLoadingMarket(true);
    try {
      const endpoint = exchange === 'nasdaq' ? '/api/nasdaq/market' : '/api/binance/market';
      const res = await fetch(`${endpoint}?symbol=${sym}&timeframe=${tf}`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: MarketData = await res.json();
        setMarketData(data);
        setMarketError(null);
        if (data.price > 0) {
          setSymbolPrices((prev) => {
            const next = { ...prev, [data.symbol]: data.price };
            return next;
          });
          setSimWallet((prev) => recalculateWallet(prev, { [data.symbol]: data.price }));
        }
        return data;
      } else {
        const err = await res.json().catch(() => ({}));
        setMarketData(null);
        setMarketError(err.error || 'Market Data Unavailable');
      }
    } catch (err: any) {
      setMarketData(null);
      setMarketError('Market Data Unavailable');
    } finally {
      setIsLoadingMarket(false);
    }
    return null;
  }, [exchange, getHeaders]);

  // Fetch Trading Account Data (Separated)
  const fetchAccountData = useCallback(async () => {
    try {
      const endpoint = exchange === 'nasdaq' ? '/api/nasdaq/account' : '/api/binance/account';
      const res = await fetch(endpoint, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: AccountInfo = await res.json();
        setAccount(data);
        setInitialEquity((prev) => (prev === null && data.equity ? data.equity : prev));
        if (data.orders) {
          setOrders(data.orders);
        }
      }
    } catch (err) {
      console.error('Failed to load trading account:', err);
    }
  }, [exchange, getHeaders]);

  // Immediate Symbol Switch (TEST 5: Old data never lingers)
  const handleSymbolChange = (newSymbol: string) => {
    setMarketData(null); // Clear previous data immediately!
    setSymbol(newSymbol);
    setAiAnalysis(null);
    fetchMarketData(newSymbol, timeframe);
  };

  // Tab switch
  const handleExchangeChange = (newExchange: ExchangeType) => {
    setExchange(newExchange);
    const newSymbol = newExchange === 'nasdaq' ? 'AAPL' : 'BTCUSDT';
    setMarketData(null);
    setSymbol(newSymbol);
    setOrderQuantity(newExchange === 'nasdaq' ? '5' : '0.00003');
    setAiAnalysis(null);
    setInitialEquity(null);
  };

  // Reset Simulation Wallet (Confirmation Modal Triggered)
  const handleResetSimulation = () => {
    setIsBotRunning(false);
    const fresh = resetSimulationWallet();
    setSimWallet(fresh);
    setShowResetConfirm(false);
    setTradeNotice('Simülasyon sıfırlandı. Yeni başlangıç bakiyesi 10.00 USDT.');
    setTimeout(() => setTradeNotice(null), 4000);
  };

  const handleResetBinanceBalance = handleResetSimulation;

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health', { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setHealthData(data);
      }
    } catch (err) {
      console.error('Health check failed:', err);
    }
    setShowHealth(true);
  };

  useEffect(() => {
    fetchMarketData(symbol, timeframe);
    fetchAccountData();
    const interval = setInterval(() => {
      fetchMarketData(symbol, timeframe);
      fetchAccountData();
    }, 12000);
    return () => clearInterval(interval);
  }, [exchange, symbol, timeframe, fetchMarketData, fetchAccountData]);

  // Execute AI Analysis with REAL market data
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

  // Execute Virtual Manual BUY
  const handleVirtualBuy = (usdtAmountToSpend?: number) => {
    if (!marketData || marketError || marketData.price <= 0) {
      setTradeNotice('Market Data Unavailable');
      setTimeout(() => setTradeNotice(null), 4000);
      return;
    }

    const amount = usdtAmountToSpend !== undefined ? usdtAmountToSpend : parseFloat(orderAmountUsdt);
    if (isNaN(amount) || amount <= 0) {
      setTradeNotice('Geçerli bir USDT tutarı girin.');
      setTimeout(() => setTradeNotice(null), 4000);
      return;
    }

    const res = executeSimulationBuy(simWallet, marketData.symbol, amount, marketData.price, 'MANUAL');
    if (res.success && res.trade) {
      setSimWallet(res.wallet);
      setTradeNotice(`Manuel ALIM başarılı: ${amount.toFixed(2)} USDT karşılığı ${res.trade.quantity} ${marketData.symbol} alındı.`);
    } else {
      setTradeNotice(`ALIM Başarısız: ${res.error || 'İşlem gerçekleştirilemedi.'}`);
    }
    setTimeout(() => setTradeNotice(null), 5000);
  };

  // Execute Virtual Manual SELL
  const handleVirtualSell = (targetSymbol?: string, targetQty?: number) => {
    const sym = targetSymbol || symbol;
    const currentPrice = (sym === marketData?.symbol && marketData ? marketData.price : symbolPrices[sym]) || 0;

    if (!currentPrice || currentPrice <= 0) {
      setTradeNotice('Market Data Unavailable');
      setTimeout(() => setTradeNotice(null), 4000);
      return;
    }

    const pos = simWallet.positions.find((p) => p.symbol === sym);
    if (!pos || pos.quantity <= 0) {
      setTradeNotice(`Satılacak ${sym} pozisyonu bulunamadı. Açığa satış (Short) yapılamaz.`);
      setTimeout(() => setTradeNotice(null), 5000);
      return;
    }

    let qtyToSell = targetQty !== undefined ? targetQty : pos.quantity;
    if (targetQty === undefined) {
      const inputAmount = parseFloat(orderAmountUsdt);
      if (!isNaN(inputAmount) && inputAmount > 0) {
        const estQty = inputAmount / currentPrice;
        qtyToSell = Math.min(pos.quantity, estQty);
      }
    }

    const res = executeSimulationSell(simWallet, sym, qtyToSell, currentPrice, 'MANUAL');
    if (res.success && res.trade) {
      setSimWallet(res.wallet);
      const pnl = res.trade.realizedPnL || 0;
      setTradeNotice(`Manuel SATIŞ başarılı: ${res.trade.quantity} ${sym} satıldı. Kar/Zarar: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} USDT`);
    } else {
      setTradeNotice(`SATIŞ Başarısız: ${res.error || 'İşlem gerçekleştirilemedi.'}`);
    }
    setTimeout(() => setTradeNotice(null), 5000);
  };

  // Execute Order (Handles both Nasdaq Alpaca & Virtual Binance)
  const handleExecuteOrder = async (side: 'BUY' | 'SELL', qty: number, executedBy: 'AI' | 'MANUAL' = 'MANUAL') => {
    if (exchange === 'binance') {
      if (side === 'BUY') {
        const estUsdt = (marketData?.price || 0) * qty;
        handleVirtualBuy(estUsdt > 0 ? estUsdt : undefined);
      } else {
        handleVirtualSell(marketData?.symbol, qty > 0 ? qty : undefined);
      }
      return;
    }

    if (!marketData || qty <= 0) return;
    setIsTrading(true);
    try {
      const endpoint = '/api/nasdaq/trade';
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
    } catch (err: any) {
      setTradeNotice('Bağlantı hatası oluştu');
      setTimeout(() => setTradeNotice(null), 5000);
    } finally {
      setIsTrading(false);
    }
  };

  // Balance Depleted Check: Auto-stop bot if equity <= 0.01 USDT
  useEffect(() => {
    if (exchange === 'binance' && simWallet.equity <= 0.01 && isBotRunning) {
      setIsBotRunning(false);
      setTradeNotice('SIMULATION BALANCE DEPLETED - Bot otomatik durduruldu.');
    }
  }, [exchange, simWallet.equity, isBotRunning]);

  // Background price refresh for all symbols in wallet positions to guarantee 100% real current Binance market data
  useEffect(() => {
    if (exchange !== 'binance') return;
    const pollPositions = async () => {
      const current = simWalletRef.current;
      const symbolsToPoll = Array.from(new Set([...BINANCE_SYMBOLS, ...current.positions.map((p) => p.symbol)]));
      const newPrices: Record<string, number> = {};

      for (const s of symbolsToPoll) {
        if (s === symbol && marketData && marketData.price > 0) {
          newPrices[s] = marketData.price;
        } else {
          try {
            const r = await fetch(`/api/binance/market?symbol=${s}&timeframe=1h`);
            if (r.ok) {
              const d = await r.json();
              if (d && d.price > 0) {
                newPrices[s] = d.price;
              }
            }
          } catch (e) {}
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setSymbolPrices((prev) => ({ ...prev, ...newPrices }));
        setSimWallet((prev) => recalculateWallet(prev, newPrices));
      }
    };

    pollPositions();
    const timer = setInterval(pollPositions, 10000);
    return () => clearInterval(timer);
  }, [exchange, symbol, marketData]);

  // Periodic Market Scanner trigger (Every 30s)
  const runMarketScan = useCallback(async () => {
    if (exchange !== 'binance') return null;
    setIsScanning(true);
    try {
      const res = await fetch('/api/binance/scanner?limit=6');
      if (res.ok) {
        const data: ScannerSummary = await res.json();
        setScannerSummary(data);
        return data;
      }
    } catch (e) {
      console.warn('Market scan error:', e);
    } finally {
      setIsScanning(false);
    }
    return null;
  }, [exchange]);

  useEffect(() => {
    if (exchange === 'binance') {
      runMarketScan();
      const t = setInterval(runMarketScan, 30000);
      return () => clearInterval(t);
    }
  }, [exchange, runMarketScan]);

  // Continuous Dynamic Multi-Asset Auto-Trading Bot Loop
  useEffect(() => {
    if (!isBotRunning) {
      setBotCountdown(botIntervalSec);
      return;
    }

    const intervalTimer = setInterval(async () => {
      setBotCountdown((prev) => {
        if (prev <= 1) {
          (async () => {
            const currentWallet = simWalletRef.current;
            if (currentWallet.equity <= 0.01) {
              setIsBotRunning(false);
              return;
            }

            const timeStr = new Date().toLocaleTimeString();

            // 1. DYNAMIC MARKET SELECTION (Multi-asset Scanner)
            let targetSymbol = symbol;
            let scannerData = scannerSummary;
            if (autoScanEnabled) {
              const freshScan = await runMarketScan();
              if (freshScan && freshScan.candidates.length > 0) {
                scannerData = freshScan;
                // Choose the candidate with highest opportunity score
                const bestCandidate = freshScan.candidates[0];
                targetSymbol = bestCandidate.symbol;
              }
            }

            // 2. FETCH REAL DATA FOR TARGET
            const mkt = await fetchMarketData(targetSymbol, timeframe);
            if (!mkt || mkt.price <= 0) {
              setBotLogs((l) => [
                { time: timeStr, msg: `${targetSymbol} | Market Data Unavailable - Pas geçildi.`, type: 'hold' },
                ...l.slice(0, 29),
              ]);
              return;
            }

            // 3. COOLDOWN CHECK
            const nowMs = Date.now();
            if (nowMs - lastTradeTimeRef.current < botCooldownSec * 1000) {
              const remainingCooldown = Math.ceil((botCooldownSec * 1000 - (nowMs - lastTradeTimeRef.current)) / 1000);
              setBotLogs((l) => [
                { time: timeStr, msg: `${mkt.symbol} | Fiyat: $${mkt.price.toFixed(2)} | Cooldown aktif (${remainingCooldown}s)`, type: 'hold' },
                ...l.slice(0, 29),
              ]);
              return;
            }

            // 4. JEV DEEP ANALYSIS
            const analysis = await runAIAnalysis(mkt);
            if (!analysis) return;

            // 5. RISK ENGINE EVALUATION
            const requestedUsdt = parseFloat((currentWallet.cash * (botTradeSizePct / 100)).toFixed(2));
            const riskDecision = evaluateTradeRisk(
              currentWallet,
              mkt.symbol,
              analysis.action,
              analysis.confidence,
              mkt.price,
              requestedUsdt,
              analysis.stopLoss,
              analysis.targetPrice,
              {
                ...DEFAULT_RISK_LIMITS,
                minConfidence: botMinConfidence,
                maxPositionSizePercent: botTradeSizePct,
              }
            );

            // Update Current Target Display
            setCurrentTarget({
              symbol: mkt.symbol,
              mode: riskDecision.marketType,
              action: analysis.action,
              confidence: analysis.confidence,
              price: mkt.price,
              suggestedUsdt: riskDecision.adjustedAmountUsdt,
              leverage: riskDecision.leverage,
              reason: analysis.reasoning,
            });

            const priceFormatted = mkt.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            // 6. EXECUTION VIA VIRTUAL SIMULATION WALLET
            if (analysis.action === 'BUY' && riskDecision.permitted) {
              const buyRes = executeSimulationBuy(
                currentWallet,
                mkt.symbol,
                riskDecision.adjustedAmountUsdt,
                mkt.price,
                'JEV_BOT',
                analysis.confidence
              );

              if (buyRes.success && buyRes.trade) {
                setSimWallet(buyRes.wallet);
                lastTradeTimeRef.current = Date.now();
                setBotLogs((l) => [
                  {
                    time: timeStr,
                    msg: `${mkt.symbol} | Fiyat: $${priceFormatted} | JEV: BUY | Güven: %${analysis.confidence} | Emir: ${riskDecision.adjustedAmountUsdt.toFixed(2)} USDT | Miktar: ${buyRes.trade?.quantity} | Status: FILLED`,
                    type: 'buy',
                  },
                  ...l.slice(0, 29),
                ]);
              }
            } else if (analysis.action === 'SELL' && riskDecision.permitted) {
              const openPos = currentWallet.positions.find((p) => p.symbol === mkt.symbol);
              if (openPos && openPos.quantity > 0) {
                const sellRes = executeSimulationSell(
                  currentWallet,
                  mkt.symbol,
                  openPos.quantity,
                  mkt.price,
                  'JEV_BOT',
                  analysis.confidence
                );

                if (sellRes.success && sellRes.trade) {
                  setSimWallet(sellRes.wallet);
                  lastTradeTimeRef.current = Date.now();
                  const pnl = sellRes.trade.realizedPnL || 0;
                  setBotLogs((l) => [
                    {
                      time: timeStr,
                      msg: `${mkt.symbol} | Fiyat: $${priceFormatted} | JEV: SELL | Güven: %${analysis.confidence} | Realized P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} USDT | Status: FILLED`,
                      type: 'sell',
                    },
                    ...l.slice(0, 29),
                  ]);
                }
              }
            } else {
              setBotLogs((l) => [
                {
                  time: timeStr,
                  msg: `${mkt.symbol} | Fiyat: $${priceFormatted} | JEV: ${analysis.action} | Güven: %${analysis.confidence} | ${riskDecision.permitted ? 'Beklemede' : riskDecision.reason}`,
                  type: 'hold',
                },
                ...l.slice(0, 29),
              ]);
            }
          })();
          return botIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalTimer);
  }, [
    isBotRunning,
    botIntervalSec,
    botMinConfidence,
    botTradeSizePct,
    botCooldownSec,
    symbol,
    timeframe,
    autoScanEnabled,
    scannerSummary,
    runMarketScan,
    fetchMarketData,
  ]);

  const currencySymbol = exchange === 'nasdaq' ? '$' : 'USDT ';
  const currentSymbols = exchange === 'nasdaq' ? NASDAQ_SYMBOLS : BINANCE_SYMBOLS;

  // Financial Calculations (100% Real Binance Virtual Simulation vs Nasdaq Paper)
  const currentEquity = exchange === 'binance' ? simWallet.equity : (account?.equity || 0);
  const currentCash = exchange === 'binance' ? simWallet.cash : (account?.buyingPower || 0);
  const initialBal = exchange === 'binance' ? simWallet.initialBalance : (initialEquity || 100000);
  const netPnL = currentEquity - initialBal;
  const netPnLPct = initialBal > 0 ? (netPnL / initialBal) * 100 : 0;

  const isMarketUnavailable = !marketData || marketError !== null || marketData.price <= 0;
  const isTradingDisabled = isMarketUnavailable || (exchange === 'nasdaq' && (account?.status === 'API_KEY_INVALID' || account?.status === 'RESTRICTED_LOCATION'));

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#0f141f]/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3 flex items-center justify-between">
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
            <p className="text-xs text-slate-400">Gerçek Piyasa Verisi & Ayrık Testnet/Paper Simülasyonu</p>
          </div>
        </div>

        {/* Exchange Switcher Tabs */}
        <div className="flex items-center bg-[#070a0f] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => handleExchangeChange('binance')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              exchange === 'binance'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Binance (Mainnet Data & Spot Testnet)</span>
          </button>

          <button
            onClick={() => handleExchangeChange('nasdaq')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              exchange === 'nasdaq'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Nasdaq (Real Data & Alpaca Paper)</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              fetchMarketData(symbol, timeframe);
              fetchAccountData();
            }}
            title="Yenile"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingMarket ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={fetchHealth}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sistem Sağlığı (Health)</span>
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
        
        {/* Left Column (8 cols): Market & Portfolio */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Account Metrics Bar - Simulation Wallet & Nasdaq Paper */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Card 1: SIMULATION EQUITY (with Reset Confirmation) */}
            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="font-semibold text-[11px] text-slate-300">
                  {exchange === 'binance' ? 'SIMULATION EQUITY' : 'ALPACA PAPER EQUITY'}
                </span>
                <div className="flex items-center gap-1.5">
                  {exchange === 'binance' && (
                    <button
                      onClick={() => setShowResetConfirm(true)}
                      title="Simülasyonu Sıfırla"
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded font-normal transition"
                    >
                      Sıfırla
                    </button>
                  )}
                  <Wallet className="w-3.5 h-3.5 text-blue-400" />
                </div>
              </div>
              <div className="text-xl font-bold tracking-tight text-white flex items-baseline justify-between">
                <span>
                  {currencySymbol}
                  {currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="text-[11px] mt-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">
                  {exchange === 'binance' ? 'Sanal Simülasyon Cüzdanı' : (account?.isDemo ? 'Sanal Sandbox Modu' : 'Canlı Testnet')}
                </span>
              </div>
            </div>

            {/* Card 2: AVAILABLE CASH */}
            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="font-semibold text-[11px] text-slate-300">
                  {exchange === 'binance' ? 'AVAILABLE CASH' : 'PAPER BUYING POWER'}
                </span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xl font-bold tracking-tight text-white">
                {currencySymbol}
                {currentCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Kullanılabilir Sanal Nakit
              </div>
            </div>

            {/* Card 3: NET P&L */}
            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="font-semibold text-[11px] text-slate-300">NET P&L</span>
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className={`text-xl font-bold tracking-tight ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netPnL >= 0 ? '+' : ''}{currencySymbol}{netPnL.toFixed(2)} ({netPnL >= 0 ? '+' : ''}{netPnLPct.toFixed(2)}%)
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Başlangıç: {currencySymbol}{initialBal.toFixed(2)}
              </div>
            </div>

            {/* Card 4: AUTOMATIC BOT STATUS */}
            <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="font-semibold text-[11px] text-slate-300">AUTOMATIC BOT STATUS</span>
                <Bot className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${isBotRunning ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`}>
                  {isBotRunning ? `BOT AKTİF (${botCountdown}s)` : 'DURDURULDU'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {exchange === 'binance'
                  ? `${simWallet.trades.filter((t) => t.source === 'JEV_BOT').length} JEV Bot Emri Verildi`
                  : `${orders.filter((o) => o.executedBy === 'AI').length} AI Emri Verildi`}
              </div>
            </div>
          </div>

          {/* SIMULATION BALANCE DEPLETED ALERT (Auto-stop & 10 USDT Reset) */}
          {exchange === 'binance' && simWallet.equity <= 0.01 && (
            <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-500/60 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm tracking-wide text-rose-200">
                    SIMULATION BALANCE DEPLETED
                  </div>
                  <div className="text-xs text-rose-300/80">
                    Sanal bakiye tükendi. Otomatik al-sat durduruldu.
                  </div>
                </div>
              </div>
              <button
                onClick={handleResetSimulation}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 whitespace-nowrap"
              >
                10 USDT İLE YENİDEN BAŞLAT
              </button>
            </div>
          )}

          {/* Real Market Price Display Card */}
          <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-5 shadow-lg flex flex-col gap-5">
            {/* Quick Symbol Pills & Timeframes */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-400 mr-1">Sembol:</span>
                {currentSymbols.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSymbolChange(s)}
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

              {/* Timeframe Switcher */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => {
                      setTimeframe(tf);
                      fetchMarketData(symbol, tf);
                    }}
                    className={`px-2 py-1 text-[11px] font-semibold rounded ${
                      timeframe === tf ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Market Error Warning If Data Unavailable */}
            {marketError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-600/40 text-rose-300 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <div>
                  <h4 className="font-bold text-xs">Piyasa Verisi Alınamadı (Market Data Unavailable)</h4>
                  <p className="text-[11px] text-rose-200/80 mt-0.5">
                    Gerçek piyasa bağlantısı sağlanamadı. Güvenlik gereği sahte fiyat üretilmez ve al-sat işlemleri kilitlenir.
                  </p>
                </div>
              </div>
            )}

            {/* Price Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight text-white">{symbol}</h1>
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded">
                    {marketData?.source || 'MAINNET FEED'}
                  </span>
                  {marketData && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      {marketData.latencyMs}ms
                    </span>
                  )}
                  {marketData?.isStale && (
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-950/80 border border-amber-600/50 px-2 py-0.5 rounded animate-pulse">
                      STALE ({marketData.staleAgeSec}s önce)
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-3 mt-1">
                  {isLoadingMarket && !marketData ? (
                    <div className="h-9 w-48 bg-slate-800 animate-pulse rounded-lg mt-1" />
                  ) : marketData ? (
                    <>
                      <span className="text-3xl font-extrabold tracking-tight text-white">
                        {currencySymbol}{marketData.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </span>
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
                    </>
                  ) : (
                    <span className="text-xl font-bold text-slate-500">Veri Bekleniyor...</span>
                  )}
                </div>
              </div>

              {/* 24h Stats */}
              <div className="grid grid-cols-3 gap-4 text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">24s En Yüksek</span>
                  <span className="font-semibold text-slate-200">
                    {marketData ? `${currencySymbol}${marketData.high24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">24s En Düşük</span>
                  <span className="font-semibold text-slate-200">
                    {marketData ? `${currencySymbol}${marketData.low24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">24s Hacim</span>
                  <span className="font-semibold text-slate-200">
                    {marketData ? marketData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '---'}
                  </span>
                </div>
              </div>
            </div>

            {/* Real Candlestick Chart from Live Market Data */}
            {marketData?.candles && marketData.candles.length > 0 && (
              <div className="mt-2 pt-4 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                  <span>Gerçek Mum / Candle Grafiği ({timeframe} Periyot)</span>
                  <span className="text-emerald-400 font-mono text-[10px]">
                    Kaynak: {marketData.source} ({marketData.candles.length} mum)
                  </span>
                </div>

                <div className="h-32 w-full flex items-end gap-1 pt-2">
                  {(() => {
                    const candles = marketData.candles;
                    const min = Math.min(...candles.map(c => c.low));
                    const max = Math.max(...candles.map(c => c.high));
                    const range = max - min || 1;

                    return candles.map((c, idx) => {
                      const isUp = c.close >= c.open;
                      const wickBottom = ((c.low - min) / range) * 100;
                      const wickHeight = Math.max(2, ((c.high - c.low) / range) * 100);

                      const bodyBottom = ((Math.min(c.open, c.close) - min) / range) * 100;
                      const bodyHeight = Math.max(3, (Math.abs(c.close - c.open) / range) * 100);

                      return (
                        <div
                          key={idx}
                          className="flex-1 relative h-full flex items-end justify-center group"
                        >
                          {/* Candle Wick */}
                          <div
                            style={{ bottom: `${wickBottom}%`, height: `${wickHeight}%` }}
                            className={`absolute w-[1.5px] ${isUp ? 'bg-emerald-400/80' : 'bg-rose-400/80'}`}
                          />
                          {/* Candle Body */}
                          <div
                            style={{ bottom: `${bodyBottom}%`, height: `${bodyHeight}%` }}
                            className={`w-full max-w-[8px] rounded-xs transition-all ${
                              isUp ? 'bg-emerald-500 group-hover:bg-emerald-400' : 'bg-rose-500 group-hover:bg-rose-400'
                            }`}
                          />
                          {/* Hover Tooltip */}
                          <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-30 pointer-events-none">
                            <div className="bg-slate-900 border border-slate-700 text-[10px] p-2 rounded shadow-2xl text-white whitespace-nowrap font-mono space-y-0.5">
                              <div className="text-slate-400">{c.time}</div>
                              <div>Açılış: {currencySymbol}{c.open}</div>
                              <div>Yüksek: {currencySymbol}{c.high}</div>
                              <div>Düşük: {currencySymbol}{c.low}</div>
                              <div className={isUp ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                Kapanış: {currencySymbol}{c.close}
                              </div>
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
                  Açık Pozisyonlar ({exchange === 'binance' ? simWallet.positions.length : (account?.positions.length || 0)})
                </button>
                <button
                  onClick={() => setActiveTableTab('orders')}
                  className={`text-xs font-bold pb-2 ml-4 transition border-b-2 ${
                    activeTableTab === 'orders'
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  İşlem Geçmişi ({exchange === 'binance' ? simWallet.trades.length : orders.length})
                </button>
              </div>
              <span className="text-[11px] text-slate-400">
                {exchange === 'binance' ? 'Gerçek Piyasa Fiyatları ile Senkronize' : (account?.statusMessage || 'Bağlı')}
              </span>
            </div>

            {/* Positions Table */}
            {activeTableTab === 'positions' && (
              <div className="overflow-x-auto mt-3">
                {exchange === 'binance' ? (
                  simWallet.positions.length > 0 ? (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800/60 pb-2">
                          <th className="py-2.5 font-medium">Symbol</th>
                          <th className="py-2.5 font-medium">Quantity</th>
                          <th className="py-2.5 font-medium">Average Entry</th>
                          <th className="py-2.5 font-medium">Real Current Price</th>
                          <th className="py-2.5 font-medium">Market Value</th>
                          <th className="py-2.5 font-medium">Unrealized P&L</th>
                          <th className="py-2.5 font-medium">P&L %</th>
                          <th className="py-2.5 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {simWallet.positions.map((pos) => {
                          const livePrice = (pos.symbol === symbol && marketData ? marketData.price : symbolPrices[pos.symbol]) || pos.currentPrice || pos.averageEntryPrice;
                          const mktVal = pos.quantity * livePrice;
                          const uPnL = (livePrice - pos.averageEntryPrice) * pos.quantity;
                          const uPnLPct = pos.averageEntryPrice > 0 ? ((livePrice - pos.averageEntryPrice) / pos.averageEntryPrice) * 100 : 0;
                          const isProfitable = uPnL >= 0;

                          return (
                            <tr key={pos.symbol} className="hover:bg-slate-800/30 transition">
                              <td className="py-3 font-semibold text-white">{pos.symbol}</td>
                              <td className="py-3 text-slate-300 font-mono">{pos.quantity}</td>
                              <td className="py-3 text-slate-300">USDT {pos.averageEntryPrice.toFixed(2)}</td>
                              <td className="py-3 text-emerald-400 font-mono">USDT {livePrice.toFixed(2)}</td>
                              <td className="py-3 text-slate-300">USDT {mktVal.toFixed(2)}</td>
                              <td className="py-3 font-medium">
                                <span className={isProfitable ? 'text-emerald-400' : 'text-rose-400'}>
                                  {isProfitable ? '+' : ''}USDT {uPnL.toFixed(4)}
                                </span>
                              </td>
                              <td className="py-3 font-medium">
                                <span className={isProfitable ? 'text-emerald-400' : 'text-rose-400'}>
                                  {isProfitable ? '+' : ''}{uPnLPct.toFixed(2)}%
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  onClick={() => handleVirtualSell(pos.symbol, pos.quantity)}
                                  disabled={isTradingDisabled}
                                  className="px-2.5 py-1 rounded bg-rose-600/20 border border-rose-500/30 text-rose-300 text-[11px] font-semibold hover:bg-rose-600/30 transition disabled:opacity-40"
                                >
                                  CLOSE / SELL
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Henüz açık simülasyon pozisyonu bulunmuyor.
                    </div>
                  )
                ) : (
                  account?.positions && account.positions.length > 0 ? (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800/60 pb-2">
                          <th className="py-2.5 font-medium">Varlık</th>
                          <th className="py-2.5 font-medium">Miktar</th>
                          <th className="py-2.5 font-medium">Giriş Fiyatı</th>
                          <th className="py-2.5 font-medium">Gerçek Piyasa Fiyatı</th>
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
                              <td className="py-3 text-emerald-400 font-mono">{currencySymbol}{pos.currentPrice.toFixed(2)}</td>
                              <td className="py-3 text-slate-300">{currencySymbol}{pos.marketValue.toFixed(2)}</td>
                              <td className="py-3 font-medium">
                                <span className={isProfitable ? 'text-emerald-400' : 'text-rose-400'}>
                                  {isProfitable ? '+' : ''}{currencySymbol}{pos.unrealizedPl.toFixed(2)} ({isProfitable ? '+' : ''}{pos.unrealizedPlPercent.toFixed(2)}%)
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  onClick={() => handleExecuteOrder('SELL', pos.quantity, 'MANUAL')}
                                  disabled={isTradingDisabled}
                                  className="px-2.5 py-1 rounded bg-rose-600/20 border border-rose-500/30 text-rose-300 text-[11px] font-semibold hover:bg-rose-600/30 transition disabled:opacity-40"
                                >
                                  CLOSE / SELL
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Henüz açık pozisyon bulunmuyor.
                    </div>
                  )
                )}
              </div>
            )}

            {/* Orders Table */}
            {activeTableTab === 'orders' && (
              <div className="overflow-x-auto mt-3">
                {exchange === 'binance' ? (
                  simWallet.trades.length > 0 ? (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800/60 pb-2">
                          <th className="py-2.5 font-medium">Time</th>
                          <th className="py-2.5 font-medium">Symbol</th>
                          <th className="py-2.5 font-medium">BUY / SELL</th>
                          <th className="py-2.5 font-medium">Execution Price</th>
                          <th className="py-2.5 font-medium">Quantity</th>
                          <th className="py-2.5 font-medium">USDT Value</th>
                          <th className="py-2.5 font-medium">Fee</th>
                          <th className="py-2.5 font-medium">Realized P&L</th>
                          <th className="py-2.5 font-medium">Source</th>
                          <th className="py-2.5 font-medium text-right">JEV Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {simWallet.trades.map((tr) => (
                          <tr key={tr.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-2.5 text-slate-400 text-[11px]">{tr.time}</td>
                            <td className="py-2.5 font-semibold text-white">{tr.symbol}</td>
                            <td className="py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  tr.side === 'BUY'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {tr.side}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-300">USDT {tr.price.toFixed(2)}</td>
                            <td className="py-2.5 font-mono text-slate-200">{tr.quantity}</td>
                            <td className="py-2.5 text-slate-300">USDT {tr.usdtValue.toFixed(2)}</td>
                            <td className="py-2.5 text-slate-400 text-[11px]">USDT {tr.fee.toFixed(4)}</td>
                            <td className="py-2.5 font-medium">
                              {tr.side === 'SELL' && tr.realizedPnL !== undefined ? (
                                <span className={tr.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  {tr.realizedPnL >= 0 ? '+' : ''}USDT {tr.realizedPnL.toFixed(4)}
                                </span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="py-2.5">
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                                {tr.source}
                              </span>
                            </td>
                            <td className="py-2.5 text-right font-mono text-[11px] text-slate-300">
                              {tr.jevConfidence ? `%${tr.jevConfidence}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Henüz işlem kaydı yok.
                    </div>
                  )
                ) : (
                  orders.length > 0 ? (
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
                  )
                )}
              </div>
            )}
          </div>
        </div>
        {/* Right Column (4 cols): AI Decision Engine & Bot */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Dynamic Market Scanner & Multi-Asset Ranking Panel */}
          {exchange === 'binance' && (
            <div className="bg-[#121824] border border-indigo-500/30 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span className="font-bold text-sm text-white">Market Scanner (Çoklu Piyasa Tarayıcısı)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
                    {scannerSummary ? `Rejim: ${scannerSummary.marketRegime}` : 'Taranıyor...'}
                  </span>
                  <button
                    onClick={() => runMarketScan()}
                    disabled={isScanning}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    title="Piyasayı Şimdi Tara"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin text-indigo-400' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Scanner Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px]">Taranan Çiftler</span>
                  <span className="font-bold text-slate-200">{scannerSummary ? `${scannerSummary.scannedCount}+` : '---'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Likidite Filtresi</span>
                  <span className="font-bold text-emerald-400">{scannerSummary ? `${scannerSummary.liquidCount} Aktif` : '---'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Dinamik Seçim</span>
                  <button
                    onClick={() => setAutoScanEnabled(!autoScanEnabled)}
                    className={`font-bold text-[10px] px-2 py-0.5 rounded mt-0.5 ${autoScanEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}
                  >
                    {autoScanEnabled ? 'AÇIK (En İyi Fırsat)' : 'SABİT SEMBOL'}
                  </button>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Maks. Pozisyon</span>
                  <span className="font-bold text-cyan-400">3 Pozisyon (Max %60)</span>
                </div>
              </div>

              {/* Current Bot Target Box */}
              {currentTarget && (
                <div className="bg-slate-950/80 p-3 rounded-xl border border-cyan-500/40 flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-cyan-400">CURRENT BOT TARGET</span>
                    <span className="text-[10px] font-mono text-slate-400">{currentTarget.mode} ({currentTarget.leverage}x)</span>
                  </div>
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-base font-bold text-white">{currentTarget.symbol}</span>
                    <span className="text-sm text-emerald-400 font-bold">${currentTarget.price.toFixed(2)}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${currentTarget.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : currentTarget.action === 'SELL' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {currentTarget.action} (%{currentTarget.confidence})
                    </span>
                  </div>
                </div>
              )}

              {/* Top Ranked Opportunities Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800 pb-1 text-[11px]">
                      <th className="py-1.5">Sembol</th>
                      <th className="py-1.5">Fiyat</th>
                      <th className="py-1.5">24s Değişim</th>
                      <th className="py-1.5">Skor</th>
                      <th className="py-1.5 text-right">Seç</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {scannerSummary?.candidates.map((c) => (
                      <tr key={c.symbol} className="hover:bg-slate-800/30 transition">
                        <td className="py-2 font-bold text-white flex items-center gap-1.5">
                          {c.symbol}
                          {c.trend === 'BULLISH' && <span className="text-[9px] text-emerald-400 font-normal">▲</span>}
                          {c.trend === 'BEARISH' && <span className="text-[9px] text-rose-400 font-normal">▼</span>}
                        </td>
                        <td className="py-2 text-slate-300 font-mono">${c.price.toFixed(2)}</td>
                        <td className={`py-2 font-semibold ${c.change24hPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {c.change24hPercent >= 0 ? '+' : ''}{c.change24hPercent.toFixed(2)}%
                        </td>
                        <td className="py-2">
                          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-bold border border-indigo-500/30 text-[10px]">
                            {c.score}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleSymbolChange(c.symbol)}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${symbol === c.symbol ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                          >
                            {symbol === c.symbol ? 'Aktif' : 'İncele'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
              Bot her <strong>{botIntervalSec} saniyede bir</strong> gerçek Binance piyasa verisini {aiEngine.toUpperCase()} modeline gönderir, %{botMinConfidence} üzeri güvenli sinyallerde sanal cüzdandan işlem açar.
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
                  <option value={15}>15 Saniye (Varsayılan)</option>
                  <option value={30}>30 Saniye</option>
                  <option value={60}>60 Saniye</option>
                  <option value={300}>5 Dakika</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Min. Güven</label>
                <select
                  value={botMinConfidence}
                  onChange={(e) => setBotMinConfidence(Number(e.target.value))}
                  disabled={isBotRunning}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value={60}>%60 Güven</option>
                  <option value={70}>%70 Güven (Varsayılan)</option>
                  <option value={80}>%80 Güven</option>
                  <option value={90}>%90 Güven</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">İşlem Büyüklüğü</label>
                <select
                  value={botTradeSizePct}
                  onChange={(e) => setBotTradeSizePct(Number(e.target.value))}
                  disabled={isBotRunning}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value={5}>%5 Nakit</option>
                  <option value={10}>%10 Nakit (Varsayılan)</option>
                  <option value={25}>%25 Nakit</option>
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
                  <option value="jev">⚡ TypeSafe Jev</option>
                  <option value="gemini">🧠 Gemini 1.5</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                if (!isBotRunning && simWallet.equity <= 0.01) {
                  setTradeNotice('Sanal bakiye tükendiği için bot başlatılamaz. Önce bakiyeyi sıfırlayın.');
                  setTimeout(() => setTradeNotice(null), 4000);
                  return;
                }
                setIsBotRunning(!isBotRunning);
              }}
              disabled={isTradingDisabled}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition ${
                isBotRunning
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/30'
              } disabled:opacity-40`}
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
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5 max-h-48 overflow-y-auto font-mono text-[11px]">
              <span className="text-slate-400 text-[10px] uppercase font-bold pb-1 border-b border-slate-800">
                Canlı Bot Log Akışı (Son Değerlendirmeler)
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
                  Bot başlatıldığında gerçek piyasa analizleri buraya akacaktır.
                </span>
              )}
            </div>
          </div>

          {/* AI Decision Single Analysis Box */}
          <div className="bg-[#121824] border border-indigo-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="font-bold text-sm text-white">Gerçek Piyasa Analizi</span>
              </div>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                {aiEngine === 'jev' ? 'TypeSafe Jev' : 'Gemini 1.5'}
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
                  <span>Gerçek Piyasa Analiz Ediliyor...</span>
                </>
              ) : (
                <>
                  <Cpu className="w-4 h-4" />
                  <span>AI Analizi Çalıştır ({symbol})</span>
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
                    disabled={isTradingDisabled}
                    className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      aiAnalysis.action === 'BUY'
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
                        : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30'
                    } disabled:opacity-40`}
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
            <h3 className="text-sm font-bold text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>{exchange === 'binance' ? 'Manuel Sanal Emir Ver' : 'Manuel Testnet Emri Ver'}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {marketData ? `Fiyat: $${marketData.price.toFixed(2)}` : 'Veri Yok'}
              </span>
            </h3>

            {tradeNotice && (
              <div className="text-xs p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
                {tradeNotice}
              </div>
            )}

            {exchange === 'binance' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>Emir Tutarı (USDT)</span>
                    <span className="text-[11px] text-emerald-400">
                      Nakit: {simWallet.cash.toFixed(2)} USDT
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    value={orderAmountUsdt}
                    onChange={(e) => setOrderAmountUsdt(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    placeholder="1.00"
                  />
                  {/* Quick percentage buttons based on AVAILABLE CASH */}
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[10, 25, 50, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          const val = ((simWallet.cash * pct) / 100).toFixed(2);
                          setOrderAmountUsdt(val);
                        }}
                        className="py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold border border-slate-700/60 transition"
                      >
                        %{pct}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={() => handleVirtualBuy()}
                    disabled={isTradingDisabled || parseFloat(orderAmountUsdt) <= 0 || simWallet.cash <= 0}
                    className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>ALIM (BUY)</span>
                  </button>

                  <button
                    onClick={() => handleVirtualSell()}
                    disabled={isTradingDisabled || !simWallet.positions.some((p) => p.symbol === symbol)}
                    className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 transition disabled:opacity-40"
                  >
                    <ArrowDownRight className="w-4 h-4" />
                    <span>SATIŞ (SELL)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Miktar ({symbol})</label>
                  <input
                    type="number"
                    step="any"
                    value={orderQuantity}
                    onChange={(e) => setOrderQuantity(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={() => handleExecuteOrder('BUY', Number(orderQuantity), 'MANUAL')}
                    disabled={isTradingDisabled || Number(orderQuantity) <= 0}
                    className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>ALIM (BUY)</span>
                  </button>

                  <button
                    onClick={() => handleExecuteOrder('SELL', Number(orderQuantity), 'MANUAL')}
                    disabled={isTradingDisabled || Number(orderQuantity) <= 0}
                    className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 transition disabled:opacity-40"
                  >
                    <ArrowDownRight className="w-4 h-4" />
                    <span>SATIŞ (SELL)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Health Modal */}
      {showHealth && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Sistem Sağlık Raporu (/api/health)</span>
              </h2>
              <button onClick={() => setShowHealth(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {healthData ? (
              <div className="space-y-3 text-xs">
                {Object.entries(healthData).filter(([k]) => k !== 'timestamp').map(([key, val]: any) => (
                  <div key={key} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-200 capitalize">{key}</div>
                      <div className="text-[11px] text-slate-400">{val.message}</div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        val.status === 'OK'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : val.status === 'UNCONFIGURED'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}>
                        {val.status}
                      </span>
                      {val.latencyMs !== undefined && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{val.latencyMs}ms</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">Yükleniyor...</div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowHealth(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Simülasyonu Sıfırla</span>
              </h3>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
              Simülasyonu sıfırlamak istediğinize emin misiniz?
              Tüm sanal pozisyonlar ve işlem geçmişi temizlenecek.
              Yeni başlangıç bakiyesi 10.00 USDT olacaktır.
            </p>
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition"
              >
                İptal
              </button>
              <button
                onClick={handleResetSimulation}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30"
              >
                Evet, Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
