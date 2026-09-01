# Contribution Guide — Hermes Agent Onboarding → OB1

Este arquivo documenta como submeter este pacote como contribuição ao repositório [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1).

## Estrutura a Submeter

```
OB1 repo root/
├── skills/
│   ├── agent-onboarding/
│   │   ├── SKILL.md
│   │   └── metadata.json
│   ├── context-bridge/
│   ├── supabase-startup-protocol/
│   ├── identity-self-audit/
│   ├── identity-cqrs/
│   ├── checkpoint-workflow/
│   ├── mbti-guru-hermes/
│   │   ├── SKILL.md
│   │   ├── metadata.json
│   │   ├── questions.py
│   │   ├── scorer.py
│   │   ├── types.py
│   │   └── run_test.py
│   ├── stage-3-financial/
│   │   ├── SKILL.md
│   │   ├── metadata.json
│   │   ├── mbti_financial_profiles.py
│   │   └── csv_importer.py
│   ├── stage-4-system-ontologist/
│   └── stage-5-agent-calibration/
├── recipes/
│   └── hermes-agent-onboarding/
│       ├── README.md
│       ├── metadata.json
│       ├── migrations/
│       │   ├── 20260530100000_user_infrastructure.sql
│       │   ├── 20260531080000_session_checkpoints.sql
│       │   ├── 20260531090000_service_role_grants.sql
│       │   └── 20260531100000_checkpoint_working_dir.sql
│       └── docs/
│           ├── 02-SUPABASE.md
│           └── 04-CUSTOMIZING.md
└── schemas/
    └── hermes-agent-onboarding/
        ├── README.md
        ├── metadata.json
        └── identity-tables.sql
```

## Regras do CONTRIBUTING.md a Observar

1. **PR title format:** `[skills] Hermes Agent Onboarding — 10 skills + recipe`
2. **Nada de `_ptBR`** — os arquivos em português ficam no repo original
3. **`metadata.json` em cada pasta** — todas as 10 skills + recipe + schema têm
4. **GRANT explícito** — migrations 20260531090000 já cobre isso
5. **Sem credenciais** — `secrets.env.example` foi deixado no repo original
6. **Tool audit link** — o README da recipe já inclui link para `docs/05-tool-audit.md`
7. **Remote MCP pattern** — Stage 4 gera Edge Functions, não servidores locais
8. **MCP tool annotations** — ferramentas de Stage 4 precisam de `readOnlyHint`/`destructiveHint`
9. **Internal links** — todos os links relativos no README da recipe resolvem para arquivos existentes

## Pré-PR Checklist

- [ ] 10 skills com SKILL.md + metadata.json
- [ ] Recipe com README.md + metadata.json
- [ ] 4 migration SQLs
- [ ] Schema com README.md + metadata.json
- [ ] Nenhum arquivo contém API keys, tokens ou senhas
- [ ] Nenhum SQL contém DROP TABLE, TRUNCATE ou DELETE sem WHERE
- [ ] Nenhum arquivo acima de 1MB
- [ ] README da recipe tem: Prerequisites, Step-by-step, Expected Outcome, Troubleshooting
- [ ] PR title começa com `[skills]` (porque a maioria do conteúdo é skills)
- [ ] Testado contra instância real do Hermes Agent

## Processo de Revisão

1. Submeter PR para [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1)
2. GitHub Action roda verificação automática (regras 1-16)
3. Revisão humana em 2-5 dias úteis
4. Ajustes conforme feedback
5. Merge

Para dúvidas: abrir uma [discussion issue](https://github.com/NateBJones-Projects/OB1/issues/new?template=extension-submission.yml) primeiro.
