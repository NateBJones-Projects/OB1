-- ================================================================
-- SESSION CHECKPOINTS — Marcos Intencionais do Espaço de Representação
-- Contexto: O checkpoint não é um log. É a marca no espaço de
-- representação do agente — onde ele estava, o que estava tentando
-- se tornar, o que descobriu sobre si, e o que carrega adiante.
--
-- Diferença fundamental de thoughts:
--   thoughts      = funil de entrada (ideias soltas, sem classificação)
--   checkpoints   = registro de estado da identidade do agente em formação
--
-- As 5 colunas centrais (territory, vector_intent, discovery,
-- consolidated_insights + operating_mode) capturam o vetor de
-- formação do agente — não só o que foi feito, mas para onde
-- o agente estava apontando.
--
-- ⚠️ Usar public. prefixo OBRIGATÓRIO para evitar schema 'extensions'
-- ================================================================

-- =================================================================
-- 1. TABELA PRINCIPAL
-- =================================================================
CREATE TABLE public.session_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ===== 1. ORIGEM (automático) =====
  session_id      TEXT NOT NULL,
  session_title   TEXT,
  model           TEXT,
  provider        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ,

  -- ===== 2. TERRITÓRIO: "Onde eu estava?" =====
  territory       TEXT NOT NULL,
  domain_scope    TEXT[] DEFAULT '{}',
  operating_mode  TEXT NOT NULL
    CHECK (operating_mode IN (
      'reflexiva', 'conceitual', 'execucao', 'diagnostico',
      'pesquisa', 'planejamento', 'decisao', 'revisao'
    )),

  -- ===== 3. VETOR: "O que eu estava tentando me tornar?" =====
  vector_intent          TEXT,
  target_capabilities    TEXT[] DEFAULT '{}',

  -- ===== 4. APRENDIZADO: "O que descobri sobre mim mesmo?" =====
  discovery             TEXT,
  pattern_recognized    TEXT,

  -- ===== 5. HERANÇA: "O que carrego adiante?" =====
  consolidated_insights  TEXT,
  legacy_refs            TEXT[],

  -- ===== 6. NAVEGAÇÃO =====
  occurred_at     DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'concluida', 'bloqueada', 'cancelada')),
  project         TEXT,
  client          TEXT,
  next_step       TEXT,
  blocker         TEXT,
  tags            TEXT[] DEFAULT '{}',

  -- ===== 7. CROSS-REFERENCE IDENTIDADE AGÊNTICA =====
  capability_refs UUID[],
  fault_refs      UUID[],
  milestone_refs  UUID[],
  decisions       JSONB DEFAULT '[]'::jsonb,

  -- ===== 8. CONTROLE =====
  value_amount    NUMERIC(10,2),
  value_currency  TEXT DEFAULT 'R$',
  deleted_at      TIMESTAMPTZ
);

-- =================================================================
-- 2. ÍNDICES
-- =================================================================

-- Pendências ativas (principal query de startup)
CREATE INDEX idx_checkpoints_pendentes
  ON public.session_checkpoints (occurred_at DESC, status)
  WHERE status = 'pendente' AND deleted_at IS NULL;

-- Filtro por projeto
CREATE INDEX idx_checkpoints_project
  ON public.session_checkpoints (project)
  WHERE deleted_at IS NULL;

-- Filtro por cliente
CREATE INDEX idx_checkpoints_client
  ON public.session_checkpoints (client)
  WHERE deleted_at IS NULL;

-- Busca por modo de operação
CREATE INDEX idx_checkpoints_operating_mode
  ON public.session_checkpoints (operating_mode, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- Cross-reference com arrays GIN (agent_capabilities, identity_faults, etc.)
CREATE INDEX idx_checkpoints_capability_refs
  ON public.session_checkpoints USING GIN (capability_refs)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_checkpoints_fault_refs
  ON public.session_checkpoints USING GIN (fault_refs)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_checkpoints_milestone_refs
  ON public.session_checkpoints USING GIN (milestone_refs)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_checkpoints_legacy_refs
  ON public.session_checkpoints USING GIN (legacy_refs)
  WHERE deleted_at IS NULL;

-- Busca por tag
CREATE INDEX idx_checkpoints_tags
  ON public.session_checkpoints USING GIN (tags)
  WHERE deleted_at IS NULL;

-- Busca por domínio
CREATE INDEX idx_checkpoints_domain_scope
  ON public.session_checkpoints USING GIN (domain_scope)
  WHERE deleted_at IS NULL;

-- =================================================================
-- 3. ROW LEVEL SECURITY — Acesso exclusivo service_role
-- =================================================================
ALTER TABLE public.session_checkpoints ENABLE ROW LEVEL SECURITY;

-- Policy única: service_role pode tudo, anon/auth não pode nada
CREATE POLICY "service_role_only" ON public.session_checkpoints FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- =================================================================
-- 4. GRANTS — Acesso mínimo para cada role
-- =================================================================
-- Service role: acesso completo (INSERT/SELECT/UPDATE/DELETE)
GRANT ALL ON public.session_checkpoints TO service_role;

-- Anon e authenticated: bloqueado (já negado pelo RLS, mas por segurança)
REVOKE ALL ON public.session_checkpoints FROM anon, authenticated;
