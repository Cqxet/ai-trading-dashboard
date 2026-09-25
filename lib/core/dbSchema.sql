-- ============================================================================
-- QUANTITATIVE TRADING TERMINAL - POSTGRESQL SCHEMA & EVENT STORE
-- Version: 2.0.0-enterprise
-- ============================================================================

-- 1. MARKETS
CREATE TABLE IF NOT EXISTS markets (
    symbol VARCHAR(32) PRIMARY KEY,
    base_asset VARCHAR(16) NOT NULL,
    quote_asset VARCHAR(16) NOT NULL,
    exchange VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'TRADING',
    min_notional NUMERIC(18, 8) DEFAULT 5.0,
    lot_step_size NUMERIC(18, 8) DEFAULT 0.0001,
    price_tick_size NUMERIC(18, 8) DEFAULT 0.01,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. STRATEGIES
CREATE TABLE IF NOT EXISTS strategies (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    compatible_regimes VARCHAR(64)[] DEFAULT ARRAY['TREND_UP', 'BREAKOUT'],
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SIGNALS (Quant Signal Engine Output)
CREATE TABLE IF NOT EXISTS signals (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL REFERENCES markets(symbol),
    strategy_id VARCHAR(64) NOT NULL REFERENCES strategies(id),
    signal_action VARCHAR(16) NOT NULL, -- BUY, SELL, HOLD, NO_TRADE
    score NUMERIC(5, 4) NOT NULL,
    trend_score NUMERIC(5, 2),
    momentum_score NUMERIC(5, 2),
    volume_score NUMERIC(5, 2),
    liquidity_score NUMERIC(5, 2),
    volatility_score NUMERIC(5, 2),
    orderbook_score NUMERIC(5, 2),
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    features_snapshot JSONB NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_ts ON signals(symbol, timestamp DESC);

-- 4. JEV_EVALUATIONS (JEV Supervisor Decisions)
CREATE TABLE IF NOT EXISTS jev_evaluations (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    regime VARCHAR(32) NOT NULL, -- TREND_UP, TREND_DOWN, RANGE, BREAKOUT, HIGH_VOLATILITY, UNSTABLE
    entry_quality NUMERIC(5, 4) NOT NULL,
    signal_conflict NUMERIC(5, 4) NOT NULL,
    liquidity_risk NUMERIC(5, 4) NOT NULL,
    volatility_risk NUMERIC(5, 4) NOT NULL,
    abnormal_market NUMERIC(5, 4) NOT NULL,
    model_confidence NUMERIC(5, 2) NOT NULL,
    reasoning TEXT,
    is_cached BOOLEAN DEFAULT FALSE,
    is_fallback BOOLEAN DEFAULT FALSE,
    valid_until BIGINT NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jev_symbol_ts ON jev_evaluations(symbol, timestamp DESC);

-- 5. RISK_DECISIONS (Hard Risk Engine Verdicts)
CREATE TABLE IF NOT EXISTS risk_decisions (
    decision_id VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    action VARCHAR(16) NOT NULL, -- ALLOW, REJECT, REDUCE_SIZE, PAUSE_SYSTEM
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_score NUMERIC(5, 2) NOT NULL,
    approved_quantity NUMERIC(18, 8),
    calculated_stop_loss NUMERIC(18, 8),
    calculated_take_profit NUMERIC(18, 8),
    estimated_slippage_cost NUMERIC(18, 8),
    estimated_fee NUMERIC(18, 8),
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_symbol_ts ON risk_decisions(symbol, timestamp DESC);

-- 6. ORDERS (Orders & Lifecycle Tracking)
CREATE TABLE IF NOT EXISTS orders (
    client_order_id VARCHAR(64) PRIMARY KEY,
    decision_id VARCHAR(64) REFERENCES risk_decisions(decision_id),
    strategy_id VARCHAR(64),
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL, -- BUY, SELL
    order_type VARCHAR(16) NOT NULL DEFAULT 'MARKET',
    status VARCHAR(32) NOT NULL, -- CREATED, SUBMITTING, FILLED, CANCELED, REJECTED
    quantity NUMERIC(18, 8) NOT NULL,
    executed_quantity NUMERIC(18, 8) DEFAULT 0,
    price NUMERIC(18, 8) NOT NULL,
    average_execution_price NUMERIC(18, 8),
    trading_mode VARCHAR(32) NOT NULL,
    fee NUMERIC(18, 8) DEFAULT 0,
    slippage_cost NUMERIC(18, 8) DEFAULT 0,
    stop_loss NUMERIC(18, 8),
    take_profit NUMERIC(18, 8),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol, created_at DESC);

-- 7. ORDER_EVENTS (Audit stream of order lifecycle state changes)
CREATE TABLE IF NOT EXISTS order_events (
    id BIGSERIAL PRIMARY KEY,
    client_order_id VARCHAR(64) NOT NULL REFERENCES orders(client_order_id),
    from_state VARCHAR(32),
    to_state VARCHAR(32) NOT NULL,
    event_timestamp BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_client_id ON order_events(client_order_id);

-- 8. POSITIONS (Current & Historical Positions)
CREATE TABLE IF NOT EXISTS positions (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL DEFAULT 'long',
    quantity NUMERIC(18, 8) NOT NULL,
    entry_price NUMERIC(18, 8) NOT NULL,
    current_price NUMERIC(18, 8) NOT NULL,
    market_value NUMERIC(18, 8) NOT NULL,
    unrealized_pnl NUMERIC(18, 8) DEFAULT 0,
    unrealized_pnl_pct NUMERIC(10, 4) DEFAULT 0,
    stop_loss NUMERIC(18, 8),
    take_profit NUMERIC(18, 8),
    highest_price NUMERIC(18, 8),
    lowest_price NUMERIC(18, 8),
    is_open BOOLEAN DEFAULT TRUE,
    entry_timestamp BIGINT NOT NULL,
    closed_at BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_positions_symbol_active ON positions(symbol, is_open);

-- 9. TRADES (Execution Records)
CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR(64) PRIMARY KEY,
    client_order_id VARCHAR(64) REFERENCES orders(client_order_id),
    decision_id VARCHAR(64) REFERENCES risk_decisions(decision_id),
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL,
    execution_price NUMERIC(18, 8) NOT NULL,
    quantity NUMERIC(18, 8) NOT NULL,
    usdt_value NUMERIC(18, 8) NOT NULL,
    gross_pnl NUMERIC(18, 8) DEFAULT 0,
    fee NUMERIC(18, 8) DEFAULT 0,
    slippage_cost NUMERIC(18, 8) DEFAULT 0,
    net_pnl NUMERIC(18, 8) DEFAULT 0,
    realized_pnl NUMERIC(18, 8) DEFAULT 0,
    source VARCHAR(32) NOT NULL DEFAULT 'QUANT_ENGINE',
    jev_regime VARCHAR(32),
    jev_confidence NUMERIC(5, 2),
    quant_score NUMERIC(5, 4),
    reasons JSONB DEFAULT '[]'::jsonb,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol_ts ON trades(symbol, timestamp DESC);

-- 10. PORTFOLIO_SNAPSHOTS
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id BIGSERIAL PRIMARY KEY,
    cash NUMERIC(18, 8) NOT NULL,
    equity NUMERIC(18, 8) NOT NULL,
    unrealized_pnl NUMERIC(18, 8) NOT NULL,
    realized_pnl NUMERIC(18, 8) NOT NULL,
    open_positions_count INT NOT NULL,
    drawdown_pct NUMERIC(10, 4) NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ts ON portfolio_snapshots(timestamp DESC);

-- 11. BOT_SESSIONS
CREATE TABLE IF NOT EXISTS bot_sessions (
    id VARCHAR(64) PRIMARY KEY,
    trading_mode VARCHAR(32) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at TIMESTAMPTZ,
    initial_equity NUMERIC(18, 8) NOT NULL,
    final_equity NUMERIC(18, 8),
    total_trades INT DEFAULT 0,
    win_trades INT DEFAULT 0,
    loss_trades INT DEFAULT 0,
    stop_reason VARCHAR(64)
);

-- 12. SYSTEM_EVENTS (Audit log)
CREATE TABLE IF NOT EXISTS system_events (
    id BIGSERIAL PRIMARY KEY,
    event_level VARCHAR(16) NOT NULL, -- debug, info, warn, error, critical
    service VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_events_ts ON system_events(timestamp DESC);

-- 13. HEALTH_METRICS
CREATE TABLE IF NOT EXISTS health_metrics (
    id BIGSERIAL PRIMARY KEY,
    binance_ws_status VARCHAR(16) NOT NULL,
    ws_latency_ms INT NOT NULL,
    tick_rate_per_sec NUMERIC(8, 2) NOT NULL,
    last_tick_age_ms INT NOT NULL,
    jev_supervisor_status VARCHAR(16) NOT NULL,
    jev_latency_ms INT,
    circuit_breaker_active BOOLEAN DEFAULT FALSE,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
