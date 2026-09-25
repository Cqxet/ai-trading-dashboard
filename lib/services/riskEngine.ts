import { SimulationWallet, SimulationPosition, SimulationTrade } from '@/types/trading';

export interface RiskDecision {
  permitted: boolean;
  reason: string;
  adjustedAmountUsdt: number;
  marketType: 'SPOT' | 'FUTURES';
  leverage: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface RiskLimits {
  maxOpenPositions: number; // default: 3 (max 5)
  maxPositionSizePercent: number; // default: 10% (max 20%)
  maxCombinedExposurePercent: number; // default: 60%
  maxAllowedLeverage: number; // default: 3x (max 5x)
  minConfidence: number; // default: 70%
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOpenPositions: 3,
  maxPositionSizePercent: 10,
  maxCombinedExposurePercent: 60,
  maxAllowedLeverage: 3,
  minConfidence: 70,
};

export function evaluateTradeRisk(
  wallet: SimulationWallet,
  symbol: string,
  action: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'HOLD',
  confidence: number,
  currentPrice: number,
  requestedAmountUsdt: number,
  targetStopLoss?: number,
  targetTakeProfit?: number,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): RiskDecision {
  if (action === 'HOLD') {
    return {
      permitted: false,
      reason: 'Sinyal HOLD olduğu için işlem açılmadı.',
      adjustedAmountUsdt: 0,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 1. Confidence check
  if (confidence < limits.minConfidence) {
    return {
      permitted: false,
      reason: `Güven skoru (%${confidence}) belirlenen minimum eşiğin (%${limits.minConfidence}) altında.`,
      adjustedAmountUsdt: 0,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 2. Sell check
  if (action === 'SELL') {
    const hasPos = wallet.positions.some((p) => p.symbol === symbol && p.quantity > 0);
    if (!hasPos) {
      return {
        permitted: false,
        reason: `${symbol} için açık pozisyon bulunmadığından satılamaz.`,
        adjustedAmountUsdt: 0,
        marketType: 'SPOT',
        leverage: 1,
      };
    }
    return {
      permitted: true,
      reason: 'Pozisyon kapatma onayı verildi.',
      adjustedAmountUsdt: requestedAmountUsdt,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 3. For BUY / LONG: Max Open Positions limit
  const isAlreadyOpen = wallet.positions.some((p) => p.symbol === symbol && p.quantity > 0);
  if (!isAlreadyOpen && wallet.positions.length >= limits.maxOpenPositions) {
    return {
      permitted: false,
      reason: `Maksimum eşzamanlı pozisyon limitine (${limits.maxOpenPositions}) ulaşıldı.`,
      adjustedAmountUsdt: 0,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 4. Maximum Position Size Limit (Default: max 10% of total equity)
  const maxAllowedUsdt = (wallet.equity * limits.maxPositionSizePercent) / 100;
  const clampedAmount = Math.min(requestedAmountUsdt, maxAllowedUsdt, wallet.cash);

  if (clampedAmount < 0.10) {
    return {
      permitted: false,
      reason: 'Kullanılabilir nakit veya izin verilen pozisyon büyüklüğü 0.10 USDT altında.',
      adjustedAmountUsdt: 0,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 5. Total Exposure Check (Max 60% of equity in open positions)
  const currentPositionsValue = wallet.positions.reduce((acc, p) => acc + p.marketValue, 0);
  const projectedExposure = currentPositionsValue + clampedAmount;
  if ((projectedExposure / wallet.equity) * 100 > limits.maxCombinedExposurePercent) {
    return {
      permitted: false,
      reason: `Toplam portföy riski %${limits.maxCombinedExposurePercent} tavanını aşıyor. Nakit korunuyor.`,
      adjustedAmountUsdt: 0,
      marketType: 'SPOT',
      leverage: 1,
    };
  }

  // 6. Leverage selection (SPOT 1x default, 2x if high confidence > 82%)
  const leverage = confidence >= 85 ? Math.min(2, limits.maxAllowedLeverage) : 1;

  // Calculate default stopLoss and takeProfit if not provided
  const sl = targetStopLoss && targetStopLoss > 0 ? targetStopLoss : currentPrice * 0.98;
  const tp = targetTakeProfit && targetTakeProfit > 0 ? targetTakeProfit : currentPrice * 1.035;

  return {
    permitted: true,
    reason: `Risk değerlendirmesi onaylandı (Boyut: ${clampedAmount.toFixed(2)} USDT, Kaldıraç: ${leverage}x).`,
    adjustedAmountUsdt: parseFloat(clampedAmount.toFixed(2)),
    marketType: 'SPOT',
    leverage,
    stopLossPrice: parseFloat(sl.toFixed(4)),
    takeProfitPrice: parseFloat(tp.toFixed(4)),
  };
}
