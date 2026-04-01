-- CookieProof PostgreSQL Schema
-- Translated from SQLite schema for production scale
-- Generated: 2026-03-01

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Core Tables
-- =============================================================================

-- Consent proof records (main audit log for GDPR compliance)
CREATE TABLE IF NOT EXISTS consent_proofs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain      VARCHAR(255) NOT NULL,
    url         TEXT,
    method      VARCHAR(50) NOT NULL,
    categories  JSONB NOT NULL,
    version     INTEGER,
    ip          VARCHAR(64),  -- Hashed IP (16 chars), but allow for future changes
    user_agent  VARCHAR(512),
    created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_proofs_domain ON consent_proofs(domain);
CREATE INDEX IF NOT EXISTS idx_consent_proofs_created ON consent_proofs(created_at);
CREATE INDEX IF NOT EXISTS idx_consent_proofs_method ON consent_proofs(method);

-- API keys table (for auto-generated / rotatable keys)
CREATE TABLE IF NOT EXISTS api_keys (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash   VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Allowed domains table (for API-managed domains alongside env var)
CREATE TABLE IF NOT EXISTS allowed_domains (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    origin     VARCHAR(2048) NOT NULL UNIQUE,
    created_at BIGINT NOT NULL
);

-- Domain configs table (stores consent banner config per domain)
CREATE TABLE IF NOT EXISTS domain_configs (
    domain     VARCHAR(255) PRIMARY KEY,
    config     JSONB NOT NULL,
    css_vars   JSONB,
    updated_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
);

-- Settings table (key-value store for server config like JWT secret)
CREATE TABLE IF NOT EXISTS settings (
    key   VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL
);

-- =============================================================================
-- Authentication & Users
-- =============================================================================

-- Users table (email + password auth)
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    totp_secret     VARCHAR(255),
    totp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    account_type    VARCHAR(50) NOT NULL DEFAULT 'user',
    token_version   INTEGER NOT NULL DEFAULT 1,
    created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Organizations table (multi-tenant isolation boundary)
CREATE TABLE IF NOT EXISTS orgs (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                  VARCHAR(255),
    plan                  VARCHAR(50) NOT NULL DEFAULT 'active',
    trial_started_at      BIGINT,
    trial_ends_at         BIGINT,
    grace_ends_at         BIGINT,
    deletion_scheduled_at BIGINT,
    created_by_agency     UUID,
    created_at            BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orgs_plan ON orgs(plan);
CREATE INDEX IF NOT EXISTS idx_orgs_created_by_agency ON orgs(created_by_agency);

-- Org members table (maps users to orgs with roles)
CREATE TABLE IF NOT EXISTS org_members (
    org_id  UUID NOT NULL,
    user_id UUID NOT NULL,
    role    VARCHAR(50) NOT NULL DEFAULT 'member',
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

-- Invite tokens table (for team invitations)
CREATE TABLE IF NOT EXISTS invite_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id     UUID NOT NULL,
    email      VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    created_by UUID NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at    BIGINT,
    created_at BIGINT NOT NULL
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL,
    used_at    BIGINT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- Email verification tokens table
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL,
    used_at    BIGINT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);

-- 2FA backup codes table
CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL,
    code_hash  VARCHAR(64) NOT NULL,
    used_at    BIGINT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_totp_backup_user ON totp_backup_codes(user_id);

-- TOTP replay protection - track recently used codes to prevent replay attacks
CREATE TABLE IF NOT EXISTS totp_used_codes (
    user_id    UUID NOT NULL,
    code_hash  VARCHAR(64) NOT NULL,
    used_at    BIGINT NOT NULL,
    PRIMARY KEY (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_totp_used_at ON totp_used_codes(used_at);

-- =============================================================================
-- Audit & Logging
-- =============================================================================

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL,
    org_id     UUID,
    action     VARCHAR(100) NOT NULL,
    details    JSONB,
    ip_address VARCHAR(64),
    user_agent VARCHAR(500),
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Telemetry events table
CREATE TABLE IF NOT EXISTS telemetry_events (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain     VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    message    TEXT,
    user_agent VARCHAR(512),
    page_url   TEXT,
    ip_hash    VARCHAR(64),
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_domain_created ON telemetry_events(domain, created_at);

-- Config fetch daily counts (for analytics)
CREATE TABLE IF NOT EXISTS config_fetch_daily (
    domain      VARCHAR(255) NOT NULL,
    day         DATE NOT NULL,
    fetch_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (domain, day)
);

-- =============================================================================
-- Webhooks
-- =============================================================================

-- Customer webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id            UUID NOT NULL,
    url               TEXT NOT NULL,
    secret            VARCHAR(255),
    events            JSONB NOT NULL DEFAULT '["consent.recorded"]',
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        UUID NOT NULL,
    created_at        BIGINT NOT NULL,
    updated_at        BIGINT NOT NULL,
    last_triggered_at BIGINT,
    failure_count     INTEGER NOT NULL DEFAULT 0,
    last_failure      TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id);

-- =============================================================================
-- Agency Features
-- =============================================================================

-- Agency branding
CREATE TABLE IF NOT EXISTS agency_branding (
    user_id     UUID PRIMARY KEY,
    logo_b64    TEXT,
    logo_mime   VARCHAR(50),
    brand_name  VARCHAR(255),
    brand_color VARCHAR(7),
    updated_at  BIGINT NOT NULL
);

-- Agency SMTP settings
CREATE TABLE IF NOT EXISTS agency_smtp (
    user_id    UUID PRIMARY KEY,
    smtp_host  VARCHAR(255),
    smtp_port  INTEGER DEFAULT 587,
    smtp_user  VARCHAR(255),
    smtp_pass  VARCHAR(255),  -- Should be encrypted in production
    smtp_from  VARCHAR(255),
    updated_at BIGINT NOT NULL
);

-- Alert log
CREATE TABLE IF NOT EXISTS alert_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID NOT NULL,
    alert_type  VARCHAR(100) NOT NULL,
    created_at  BIGINT NOT NULL,
    notified_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_alert_log_org ON alert_log(org_id);

-- Scheduled reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL,
    created_by      UUID NOT NULL,
    frequency       VARCHAR(20) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    next_run_at     BIGINT NOT NULL,
    last_run_at     BIGINT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next ON scheduled_reports(next_run_at, enabled);

-- =============================================================================
-- Billing & Subscriptions (Mollie-ready)
-- =============================================================================

-- Pricing plans
CREATE TABLE IF NOT EXISTS pricing_plans (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(100) NOT NULL,
    price_cents  INTEGER NOT NULL,
    currency     VARCHAR(3) NOT NULL DEFAULT 'EUR',
    interval     VARCHAR(20) NOT NULL DEFAULT 'month',
    features     JSONB,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   BIGINT NOT NULL
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                 UUID NOT NULL,
    plan_id                UUID NOT NULL,
    status                 VARCHAR(50) NOT NULL DEFAULT 'pending',
    mollie_customer_id     VARCHAR(255),
    mollie_subscription_id VARCHAR(255),
    mollie_mandate_id      VARCHAR(255),
    current_period_start   BIGINT,
    current_period_end     BIGINT,
    cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at            BIGINT,
    created_at             BIGINT NOT NULL,
    updated_at             BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_mollie_sub ON subscriptions(mollie_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id            UUID NOT NULL,
    subscription_id   UUID,
    mollie_payment_id VARCHAR(255) UNIQUE,
    amount_cents      INTEGER NOT NULL,
    currency          VARCHAR(3) NOT NULL DEFAULT 'EUR',
    status            VARCHAR(50) NOT NULL DEFAULT 'pending',
    description       TEXT,
    metadata          JSONB,
    paid_at           BIGINT,
    created_at        BIGINT NOT NULL,
    updated_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id);
CREATE INDEX IF NOT EXISTS idx_payments_mollie ON payments(mollie_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);

-- Billing lifecycle events tracking
CREATE TABLE IF NOT EXISTS billing_lifecycle_events (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID NOT NULL,
    event_type    VARCHAR(100) NOT NULL,
    email_sent_to VARCHAR(255),
    data          JSONB,
    created_at    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_lifecycle_org ON billing_lifecycle_events(org_id);
CREATE INDEX IF NOT EXISTS idx_billing_lifecycle_type ON billing_lifecycle_events(event_type);

-- =============================================================================
-- Seed Default Pricing Plans (idempotent)
-- =============================================================================

INSERT INTO pricing_plans (id, name, price_cents, currency, interval, features, is_active, created_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Starter', 1900, 'EUR', 'month',
     '["1 domain", "Basic analytics", "Email support"]', TRUE, EXTRACT(EPOCH FROM NOW()) * 1000),
    ('00000000-0000-0000-0000-000000000002', 'Professional', 4900, 'EUR', 'month',
     '["5 domains", "Advanced analytics", "Priority support", "Custom branding"]', TRUE, EXTRACT(EPOCH FROM NOW()) * 1000),
    ('00000000-0000-0000-0000-000000000003', 'Agency', 14900, 'EUR', 'month',
     '["Unlimited domains", "White-label", "API access", "Dedicated support"]', TRUE, EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Cleanup function for expired TOTP codes (call via cron or pg_cron)
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_totp_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM totp_used_codes WHERE used_at < (EXTRACT(EPOCH FROM NOW()) * 1000 - 120000);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Data retention cleanup function
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_consent_proofs(retention_days INTEGER)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM consent_proofs
    WHERE created_at < (EXTRACT(EPOCH FROM NOW()) * 1000 - (retention_days * 86400000));
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
