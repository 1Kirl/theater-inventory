import { describe, expect, it } from 'vitest'
import { cameraErrorKind, cameraErrorMessage } from '@/features/scanner/scanner-camera'

describe('working out why the camera did not open', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not_found'],
    ['DevicesNotFoundError', 'not_found'],
    ['OverconstrainedError', 'not_found'],
    ['NotReadableError', 'in_use'],
    ['TrackStartError', 'in_use'],
  ] as const)('reads %s as %s', (name, kind) => {
    // Browsers disagree about which name they use for the same refusal, and the
    // distinction matters: "you said no" and "there is no camera" need
    // different things from the person reading them.
    const error = Object.assign(new Error('nope'), { name })
    expect(cameraErrorKind(error)).toBe(kind)
  })

  it('falls back to unknown for anything it does not recognise', () => {
    expect(cameraErrorKind(Object.assign(new Error('x'), { name: 'WeirdError' }))).toBe('unknown')
    expect(cameraErrorKind(new Error('plain'))).toBe('unknown')
    expect(cameraErrorKind('a string')).toBe('unknown')
    expect(cameraErrorKind(null)).toBe('unknown')
    expect(cameraErrorKind(undefined)).toBe('unknown')
    expect(cameraErrorKind({})).toBe('unknown')
  })
})

describe('what the person is told', () => {
  it('asks for permission when permission is the problem', () => {
    const message = cameraErrorMessage('denied')
    expect(message).toContain('Camera access is required')
    expect(message).toContain('browser settings')
  })

  it('says there is no camera when there is no camera', () => {
    expect(cameraErrorMessage('not_found')).toBe('No camera is available on this device.')
  })

  it('names the fix for an insecure origin', () => {
    expect(cameraErrorMessage('insecure_context')).toContain('https')
  })

  it('suggests a browser that works when this one cannot', () => {
    const message = cameraErrorMessage('unsupported')
    expect(message).toContain('Safari')
    expect(message).toContain('Chrome')
  })

  it('never shows a raw browser exception', () => {
    for (const kind of [
      'denied', 'not_found', 'in_use', 'insecure_context', 'unsupported', 'unknown',
    ] as const) {
      const message = cameraErrorMessage(kind)
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain('Error')
      expect(message).not.toContain('getUserMedia')
      expect(message).not.toContain('NotAllowed')
      // Every one of them tells the person something they can do.
      expect(message).toMatch(/[.!]$/)
    }
  })
})
