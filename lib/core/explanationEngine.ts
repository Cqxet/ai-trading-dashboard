import { AuditDecisionRecord } from './types';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class ExplanationEngine {
  private static instance: ExplanationEngine;

  public static getInstance(): ExplanationEngine {
    if (!ExplanationEngine.instance) {
      ExplanationEngine.instance = new ExplanationEngine();
    }
    return ExplanationEngine.instance;
  }

  /**
   * Generates a plain-text human-readable post-mortem explanation for an audit decision.
   * STRICT GUARANTEE: This explanation layer is purely descriptive and NEVER alters execution or risk decisions.
   */
  public async explainDecision(audit: AuditDecisionRecord, apiKey?: string): Promise<string> {
    const geminiKey = apiKey || process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `
You are a senior quantitative risk officer explaining a trading engine decision to an institutional operator.
Analyze this audit snapshot and explain in 2-3 concise bullet points why this decision was made:

Symbol: ${audit.symbol}
Market Price: ${audit.marketPrice}
Quant Signal: ${audit.quantSignal.signal} (Score: ${(audit.quantSignal.score * 100).toFixed(0)}%, Strategy: ${audit.quantSignal.strategy})
Quant Score Breakdown: Trend=${audit.quantSignal.breakdown.trendScore}, Momentum=${audit.quantSignal.breakdown.momentumScore}, Volume=${audit.quantSignal.breakdown.volumeScore}, Liquidity=${audit.quantSignal.breakdown.liquidityScore}, Volatility=${audit.quantSignal.breakdown.volatilityScore}, Orderbook=${audit.quantSignal.breakdown.orderbookScore}
JEV Supervisor: Regime=${audit.jevEvaluation?.regime || 'N/A'}, Entry Quality=${audit.jevEvaluation?.entryQuality || 'N/A'}, Volatility Risk=${audit.jevEvaluation?.volatilityRisk || 'N/A'}, Liquidity Risk=${audit.jevEvaluation?.liquidityRisk || 'N/A'}
Risk Engine Action: ${audit.riskDecision.action}
Risk Reasons: ${audit.riskDecision.reasons.join(', ')}

Provide an authoritative, clear explanation.`;

        const response = await model.generateContent(prompt);
        return response.response.text();
      } catch (err: any) {
        console.warn('[EXPLANATION_ENGINE] Gemini API call failed, falling back to rule-based template:', err.message);
      }
    }

    // Deterministic fallback explanation
    const { quantSignal, riskDecision, jevEvaluation, symbol, marketPrice } = audit;
    const actionText = riskDecision.action === 'ALLOW' ? 'ONAYLANDI' : (riskDecision.action === 'REDUCE_SIZE' ? 'BOYUT DÜŞÜRÜLEREK ONAYLANDI' : 'REDDEDİLDİ');

    return `
[KARAR ÖZETİ - ${symbol} @ ${marketPrice}]
• Karar Sonucu: ${actionText} (Risk Skoru: ${riskDecision.riskScore}/100)
• Quant Sinyali: ${quantSignal.signal} (Toplam Skor: ${quantSignal.breakdown.totalScore}/100, Strateji: ${quantSignal.strategy})
• JEV Supervisor: Rejim=${jevEvaluation?.regime || 'Belirsiz'}, Giriş Kalitesi=%${((jevEvaluation?.entryQuality || 0) * 100).toFixed(0)}, Likidite Riski=%${((jevEvaluation?.liquidityRisk || 0) * 100).toFixed(0)}
• Risk Gerekçeleri: ${riskDecision.reasons.join('; ')}
`.trim();
  }
}

export const explanationEngine = ExplanationEngine.getInstance();
