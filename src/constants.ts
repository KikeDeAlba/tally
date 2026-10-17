export const DEFAULT_PENDING_LOOKBACK_DAYS = 90

export const MAX_TASK_SECONDS = 8 * 60 * 60
export const ESTIMATE_STEP_SECONDS = 30 * 60

export const SUMMARY_NOTES_BUDGET_BYTES = 262_144
export const NOTES_CONCURRENCY = 6

export const DEFAULT_START_DATE_FIELD = 'customfield_10015'
export const DEFAULT_WORK_ISSUE_TYPE = 'Subtarea'
export const DEFAULT_FLAT_ISSUE_TYPE = 'Tarea'

export interface StoryTheme {
  id: string
  name: string
}

export const DEFAULT_STORY_THEMES: readonly StoryTheme[] = [
  { id: 'devops', name: 'DevOps' },
  { id: 'backend', name: 'Backend' },
  { id: 'frontend', name: 'Frontend' },
  { id: 'infra', name: 'Infraestructura' },
  { id: 'analisis', name: 'Análisis y estimación' },
  { id: 'seguridad', name: 'Seguridad' },
  { id: 'soporte', name: 'Soporte' },
  { id: 'sesiones', name: 'Sesiones y reuniones' },
  { id: 'docs', name: 'Documentación' },
]
