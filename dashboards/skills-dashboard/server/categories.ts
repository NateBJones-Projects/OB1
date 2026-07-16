/**
 * Classification rubric. Matching order: manual overrides → name-token rules
 * (longer phrases before short keywords) → description keywords → Other.
 * Edit OVERRIDES / RULES freely to retune the grouping.
 */

export const CATEGORIES = [
  'Open Brain & Memory',
  'Research & Analysis',
  'Documents & Files',
  'Design & Frontend',
  'Dev Workflow',
  'Skill & Agent Authoring',
  'Browser & Automation',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Skill-name → category pins for anything the rules below misfile. */
const OVERRIDES: Record<string, Category> = {
  'panning-for-gold': 'Open Brain & Memory',
  'weekly-signal-diff': 'Research & Analysis',
  imagine: 'Design & Frontend',
  imagegen: 'Design & Frontend',
  'heavy-file-ingestion': 'Documents & Files',
}

interface Rule {
  category: Category
  /** Matched against the normalized skill name (substring). */
  nameTokens: string[]
  /** Matched against the description, lowercased (substring). */
  descTokens: string[]
}

// Longer/more specific phrases first within each list; rules are evaluated in order.
const RULES: Rule[] = [
  {
    category: 'Open Brain & Memory',
    nameTokens: [
      'open-brain', 'brain', 'capture', 'recall', 'thought', 'entities', 'entity',
      'wiki', 'provenance', 'memory', 'remember', 'dream', 'atomiz', 'consolidate',
    ],
    descTokens: ['open brain', 'knowledge graph', 'memory system', 'capture to'],
  },
  {
    category: 'Research & Analysis',
    nameTokens: [
      'research', 'synthesis', 'competitive', 'signal', 'deal-memo', 'financial',
      'meeting', 'world-model', 'work-operating', 'analysis', 'decision',
    ],
    descTokens: ['research', 'synthesiz', 'competitor', 'diligence', 'decision brief'],
  },
  {
    category: 'Documents & Files',
    nameTokens: ['docx', 'pptx', 'xlsx', 'pdf', 'doc-coauthoring', 'file-ingestion', 'document'],
    descTokens: ['spreadsheet', 'presentation', 'word document', 'pdf file'],
  },
  {
    category: 'Design & Frontend',
    nameTokens: [
      'frontend', 'design', 'canvas', 'theme', 'artifact', 'dataviz', 'web-artifacts',
      'brand', 'slack-gif', 'algorithmic-art',
    ],
    descTokens: ['visual design', 'ui design', 'chart', 'visualization'],
  },
  {
    category: 'Skill & Agent Authoring',
    nameTokens: [
      'skill-creator', 'skill-installer', 'skill-development', 'writing-skills',
      'aiception', 'claudeception', 'mcp-builder', 'mcp-server', 'mcp-integration',
      'plugin', 'hook', 'agent-sdk', 'agent-creator', 'agentic-harness', 'create-skill',
      'subagent', 'superpowers',
    ],
    descTokens: ['create a skill', 'creating skills', 'mcp server', 'agent harness', 'subagent'],
  },
  {
    category: 'Browser & Automation',
    nameTokens: ['chrome', 'playwright', 'devtools', 'browser', 'webapp-testing', 'computer'],
    descTokens: ['browser automation', 'chrome devtools', 'automate the browser'],
  },
  {
    category: 'Dev Workflow',
    nameTokens: [
      'code-review', 'review', 'debug', 'test-driven', 'tdd', 'git', 'commit',
      'worktree', 'brainstorm', 'plan', 'verification', 'check-work', 'help',
      'simplif', 'claude-md', 'keybinding', 'update-config', 'statusline', 'setup',
      'openai-docs', 'claude-api', 'loop', 'schedule', 'terminal', 'supabase',
      'auth0', 'airflow', 'session-report',
    ],
    descTokens: ['code review', 'debugging', 'pull request', 'workflow', 'cli'],
  },
]

export function categorize(key: string, description: string): Category {
  const override = OVERRIDES[key]
  if (override) return override
  for (const rule of RULES) {
    if (rule.nameTokens.some((t) => key.includes(t))) return rule.category
  }
  const desc = description.toLowerCase()
  for (const rule of RULES) {
    if (rule.descTokens.some((t) => desc.includes(t))) return rule.category
  }
  return 'Other'
}
