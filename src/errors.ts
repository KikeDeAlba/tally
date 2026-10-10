export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  notFound: 3,
  conflict: 4,
} as const

export class TallyError extends Error {
  readonly code: string
  readonly hint: string | undefined
  readonly exitCode: number

  constructor(message: string, code: string, options: { hint?: string | undefined; exitCode?: number } = {}) {
    super(message)
    this.name = 'TallyError'
    this.code = code
    this.hint = options.hint
    this.exitCode = options.exitCode ?? EXIT.failure
  }
}

export class UsageError extends TallyError {
  constructor(message: string, hint?: string) {
    super(message, 'USAGE_ERROR', { hint, exitCode: EXIT.usage })
    this.name = 'UsageError'
  }
}

export class NotFoundError extends TallyError {
  constructor(message: string, code: string, hint?: string) {
    super(message, code, { hint, exitCode: EXIT.notFound })
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends TallyError {
  constructor(message: string, code: string, hint?: string) {
    super(message, code, { hint, exitCode: EXIT.conflict })
    this.name = 'ConflictError'
  }
}
