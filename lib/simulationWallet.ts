import { SimulationWallet, SimulationPosition, SimulationTrade } from '@/types/trading';

export const SIMULATION_WALLET_STORAGE_KEY = 'quant_jev_simulation_wallet_v1';
export const INITIAL_SIMULATION_BALANCE = 10.0;
// Official Binance Spot Trading Fee: 0.1% standard (0.075% with BNB deduction)
export const TRADING_FEE_RATE = 0.001; // %0.1 Standart Binance Spot İşlem Komisyonu
export const SIMULATED_SLIPPAGE_RATE = 0.00025; // 0.025% default slippage

export function createDefaultWallet(): SimulationWallet {
  const now = Date.now();
  return {
    version: 1,
    initialBalance: INITIAL_SIMULATION_BALANCE,
    cash: INITIAL_SIMULATION_BALANCE,
    equity: INITIAL_SIMULATION_BALANCE,
    realizedPnL: 0,
    positions: [],
    trades: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadSimulationWallet(): SimulationWallet {
  if (typeof window === 'undefined') {
    return createDefaultWallet();
  }

  try {
    const raw = localStorage.getItem(SIMULATION_WALLET_STORAGE_KEY);
    if (!raw) {
      const fresh = createDefaultWallet();
      saveSimulationWallet(fresh);
      return fresh;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.cash !== 'number' || isNaN(parsed.cash)) {
      console.warn('Invalid or outdated simulation wallet state found. Reinitializing 10 USDT wallet.');
      const fresh = createDefaultWallet();
      saveSimulationWallet(fresh);
      return fresh;
    }

    return parsed;
  } catch (err) {
    console.error('Error loading simulation wallet, resetting to 10 USDT:', err);
    const fresh = createDefaultWallet();
    saveSimulationWallet(fresh);
    return fresh;
  }
}

export function saveSimulationWallet(wallet: SimulationWallet): void {
  if (typeof window === 'undefined') return;
  try {
    wallet.updatedAt = Date.now();
    localStorage.setItem(SIMULATION_WALLET_STORAGE_KEY, JSON.stringify(wallet));
  } catch (err) {
    console.error('Failed to persist simulation wallet:', err);
  }
}

export function recalculateWallet(
  wallet: SimulationWallet,
  currentPrices: Record<string, number>
): SimulationWallet {
  let positionsMarketValue = 0;

  const updatedPositions = wallet.positions.map((pos) => {
    const livePrice = currentPrices[pos.symbol] || pos.currentPrice || pos.averageEntryPrice;
    const marketValue = pos.quantity * livePrice;
    const unrealizedPnL = (livePrice - pos.averageEntryPrice) * pos.quantity;
    const unrealizedPnLPercent = pos.averageEntryPrice > 0
      ? ((livePrice / pos.averageEntryPrice) - 1) * 100
      : 0;

    positionsMarketValue += marketValue;

    return {
      ...pos,
      currentPrice: livePrice,
      marketValue: parseFloat(marketValue.toFixed(4)),
      unrealizedPnL: parseFloat(unrealizedPnL.toFixed(4)),
      unrealizedPnLPercent: parseFloat(unrealizedPnLPercent.toFixed(2)),
    };
  });

  const totalEquity = wallet.cash + positionsMarketValue;

  return {
    ...wallet,
    positions: updatedPositions,
    equity: parseFloat(totalEquity.toFixed(4)),
  };
}

export function executeSimulationBuy(
  wallet: SimulationWallet,
  symbol: string,
  usdtAmount: number,
  currentPrice: number,
  source: 'MANUAL' | 'JEV_BOT' = 'MANUAL',
  jevConfidence?: number
): { success: boolean; wallet: SimulationWallet; trade?: SimulationTrade; error?: string } {
  if (currentPrice <= 0) {
    return { success: false, wallet, error: 'Piyasa fiyatı geçersiz veya 0.' };
  }

  if (usdtAmount < 0.10) {
    return { success: false, wallet, error: 'Minimum işlem tutarı 0.10 USDT olmalıdır.' };
  }

  if (wallet.cash < usdtAmount) {
    return {
      success: false,
      wallet,
      error: `Yetersiz bakiye: Kullanılabilir nakit ${wallet.cash.toFixed(2)} USDT, talep edilen: ${usdtAmount.toFixed(2)} USDT`,
    };
  }

  const fee = parseFloat((usdtAmount * TRADING_FEE_RATE).toFixed(6));
  const effectiveValue = usdtAmount - fee;
  // Apply realistic simulation slippage (+0.025% higher on buy)
  const execPrice = parseFloat((currentPrice * (1 + SIMULATED_SLIPPAGE_RATE)).toFixed(4));
  const quantity = parseFloat((effectiveValue / execPrice).toFixed(8));

  if (quantity <= 0) {
    return { success: false, wallet, error: 'Hesaplanan miktar çok küçük.' };
  }

  const newCash = parseFloat((wallet.cash - usdtAmount).toFixed(4));

  const existingIndex = wallet.positions.findIndex((p) => p.symbol === symbol);
  let newPositions: SimulationPosition[] = [...wallet.positions];

  if (existingIndex >= 0) {
    const prev = newPositions[existingIndex];
    const totalQty = prev.quantity + quantity;
    const totalCost = (prev.quantity * prev.averageEntryPrice) + (quantity * execPrice);
    const newAvg = totalCost / totalQty;

    newPositions[existingIndex] = {
      symbol,
      quantity: parseFloat(totalQty.toFixed(8)),
      averageEntryPrice: parseFloat(newAvg.toFixed(4)),
      currentPrice: execPrice,
      marketValue: parseFloat((totalQty * execPrice).toFixed(4)),
      unrealizedPnL: parseFloat(((execPrice - newAvg) * totalQty).toFixed(4)),
      unrealizedPnLPercent: parseFloat((((execPrice / newAvg) - 1) * 100).toFixed(2)),
    };
  } else {
    newPositions.push({
      symbol,
      quantity,
      averageEntryPrice: execPrice,
      currentPrice: execPrice,
      marketValue: parseFloat((quantity * execPrice).toFixed(4)),
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
    });
  }

  const now = Date.now();
  const trade: SimulationTrade = {
    id: `sim-trade-${now}-${Math.floor(Math.random() * 1000)}`,
    timestamp: now,
    time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    symbol,
    side: 'BUY',
    price: execPrice,
    quantity,
    usdtValue: usdtAmount,
    fee,
    jevConfidence,
    source,
    status: 'FILLED',
  };

  const updatedWallet: SimulationWallet = {
    ...wallet,
    cash: newCash,
    positions: newPositions,
    trades: [trade, ...wallet.trades.slice(0, 99)],
  };

  const finalWallet = recalculateWallet(updatedWallet, { [symbol]: currentPrice });
  saveSimulationWallet(finalWallet);

  return { success: true, wallet: finalWallet, trade };
}

export function executeSimulationSell(
  wallet: SimulationWallet,
  symbol: string,
  sellQuantity: number,
  currentPrice: number,
  source: 'MANUAL' | 'JEV_BOT' = 'MANUAL',
  jevConfidence?: number
): { success: boolean; wallet: SimulationWallet; trade?: SimulationTrade; error?: string } {
  if (currentPrice <= 0) {
    return { success: false, wallet, error: 'Piyasa fiyatı geçersiz veya 0.' };
  }

  const existingIndex = wallet.positions.findIndex((p) => p.symbol === symbol);
  if (existingIndex < 0) {
    return { success: false, wallet, error: `${symbol} için açık pozisyon bulunamadı.` };
  }

  const pos = wallet.positions[existingIndex];
  const actualQty = Math.min(sellQuantity, pos.quantity);

  if (actualQty <= 0) {
    return { success: false, wallet, error: 'Satılacak miktar geçersiz.' };
  }

  // Apply realistic simulation slippage (-0.025% lower on sell)
  const execPrice = parseFloat((currentPrice * (1 - SIMULATED_SLIPPAGE_RATE)).toFixed(4));
  const grossProceeds = actualQty * execPrice;
  const fee = parseFloat((grossProceeds * TRADING_FEE_RATE).toFixed(6));
  const netProceeds = parseFloat((grossProceeds - fee).toFixed(4));
  const costBasis = actualQty * pos.averageEntryPrice;
  const realizedPnL = parseFloat((netProceeds - costBasis).toFixed(4));

  const newCash = parseFloat((wallet.cash + netProceeds).toFixed(4));
  const remainingQty = parseFloat((pos.quantity - actualQty).toFixed(8));

  let newPositions: SimulationPosition[] = [...wallet.positions];
  if (remainingQty <= 0.00000001) {
    newPositions.splice(existingIndex, 1);
  } else {
    newPositions[existingIndex] = {
      ...pos,
      quantity: remainingQty,
      currentPrice: execPrice,
      marketValue: parseFloat((remainingQty * execPrice).toFixed(4)),
      unrealizedPnL: parseFloat(((execPrice - pos.averageEntryPrice) * remainingQty).toFixed(4)),
      unrealizedPnLPercent: parseFloat((((execPrice / pos.averageEntryPrice) - 1) * 100).toFixed(2)),
    };
  }

  const now = Date.now();
  const trade: SimulationTrade = {
    id: `sim-trade-${now}-${Math.floor(Math.random() * 1000)}`,
    timestamp: now,
    time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    symbol,
    side: 'SELL',
    price: execPrice,
    quantity: actualQty,
    usdtValue: parseFloat(grossProceeds.toFixed(4)),
    fee,
    realizedPnL,
    jevConfidence,
    source,
    status: 'FILLED',
  };

  const updatedWallet: SimulationWallet = {
    ...wallet,
    cash: newCash,
    realizedPnL: parseFloat((wallet.realizedPnL + realizedPnL).toFixed(4)),
    positions: newPositions,
    trades: [trade, ...wallet.trades.slice(0, 99)],
  };

  const finalWallet = recalculateWallet(updatedWallet, { [symbol]: currentPrice });
  saveSimulationWallet(finalWallet);

  return { success: true, wallet: finalWallet, trade };
}

export function resetSimulationWallet(): SimulationWallet {
  const fresh = createDefaultWallet();
  saveSimulationWallet(fresh);
  return fresh;
}
