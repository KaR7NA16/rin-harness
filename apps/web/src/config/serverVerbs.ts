import type { TranslationKey } from '../i18n/locales/en'

export const SERVER_VERB_KEYS: Record<string, TranslationKey> = {
  Thinking: 'serverVerb.Thinking',
  'Task started': 'serverVerb.Task started',
  'Task in progress': 'serverVerb.Task in progress',
  'Switching provider and model...': 'serverVerb.Switching provider and model',
  'Restarting session with new permissions...': 'serverVerb.Restarting session with new permissions',
}

export const RUNTIME_TRANSITION_STATUS_VERBS: ReadonlySet<string> = new Set([
  'Switching provider and model...',
  'Restarting session with new permissions...',
])
