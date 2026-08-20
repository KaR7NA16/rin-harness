import type { ModelInfo } from '../types/settings'

export const OFFICIAL_DEFAULT_MODEL_ID = 'deepseek-chat'

export const OFFICIAL_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    description: 'DeepSeek V3 — general conversation and coding',
    context: '128k',
    contextWindow: 128_000,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    description: 'DeepSeek R1 — deep reasoning tasks',
    context: '128k',
    contextWindow: 128_000,
  },
]
