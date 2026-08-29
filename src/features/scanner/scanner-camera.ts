import jsQR from 'jsqr'

/**
 * The camera, kept behind a small seam.
 *
 * Everything that needs real hardware lives here and nowhere else, so the parts
 * that decide what a scan means — parsing, deduplication, which lifecycle move a
 * mode implies — stay ordinary functions that can be tested without a phone.
 *
 * Frames never leave the device. They are drawn to a canvas in this browser, a
 * decoder written in JavaScript reads the pixels, and the only thing that
 * escapes this module is the short string a QR encodes. No image is uploaded,
 * stored, sent to Firebase, or handed to any third party, and none is kept after
 * the frame it was decoded from.
 */

export type CameraErrorKind =
  | 'denied'
  | 'not_found'
  | 'insecure_context'
  | 'unsupported'
  | 'in_use'
  | 'unknown'

/**
 * What went wrong, from a `getUserMedia` rejection.
 *
 * Browsers disagree about which name they use, and the distinction matters:
 * "you refused" and "there is no camera" need different things from the person
 * reading them.
 */
export function cameraErrorKind(error: unknown): CameraErrorKind {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    switch ((error as { name: string }).name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return 'denied'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
      case 'OverconstrainedError':
        return 'not_found'
      case 'NotReadableError':
      case 'TrackStartError':
        return 'in_use'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}

export function cameraErrorMessage(kind: CameraErrorKind): string {
  switch (kind) {
    case 'denied':
      return 'Camera access is required to scan equipment. '
        + 'Allow it in your browser settings and try again.'
    case 'not_found':
      return 'No camera is available on this device.'
    case 'in_use':
      return 'The camera is being used by another app. Close it and try again.'
    case 'insecure_context':
      return 'Scanning needs a secure connection. Open this site over https.'
    case 'unsupported':
      return 'This browser cannot open a camera. Try Safari on iPhone or Chrome on Android.'
    case 'unknown':
      return 'The camera could not be started. Try again.'
  }
}

/** Whether this browser can be asked for a camera at all. */
export function cameraAvailability(): { ok: true } | { ok: false; kind: CameraErrorKind } {
  if (typeof window === 'undefined') return { ok: false, kind: 'unsupported' }
  // getUserMedia is only exposed on secure origins. localhost counts as one,
  // which is what makes development possible.
  if (!window.isSecureContext) return { ok: false, kind: 'insecure_context' }
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, kind: 'unsupported' }
  return { ok: true }
}

export interface CameraScanner {
  /** Stops decoding and releases every track. Safe to call more than once. */
  stop: () => void
}

/**
 * The largest edge the decoder is given.
 *
 * A phone hands over 1080p or more, and decoding that many pixels ten times a
 * second heats the device and flattens the battery for no benefit — a QR big
 * enough to aim at is still several hundred pixels across at this size.
 */
const MAX_DECODE_EDGE = 640

/** Roughly ten looks a second. Faster finds nothing sooner and costs battery. */
const DECODE_INTERVAL_MS = 100

export async function startCameraScanner(params: {
  video: HTMLVideoElement
  onDecode: (value: string) => void
  onError: (kind: CameraErrorKind) => void
}): Promise<CameraScanner> {
  const availability = cameraAvailability()
  if (!availability.ok) {
    params.onError(availability.kind)
    return { stop: () => {} }
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The back camera on a phone, which is the one pointed at equipment.
      // `ideal` rather than `exact` so a laptop with one camera still works.
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
  } catch (caught) {
    params.onError(cameraErrorKind(caught))
    return { stop: () => {} }
  }

  const video = params.video
  video.srcObject = stream
  // Required by iOS Safari, which otherwise takes the video full screen.
  video.setAttribute('playsinline', 'true')
  video.muted = true

  let stopped = false
  let frame = 0
  let lastDecode = 0
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  function stop() {
    if (stopped) return
    stopped = true

    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0

    // Every track, not just the first. A stream left running keeps the
    // recording indicator lit and the camera warm after the user has left.
    for (const track of stream.getTracks()) track.stop()

    if (video.srcObject === stream) video.srcObject = null
    document.removeEventListener('visibilitychange', onVisibility)
  }

  // Decoding an invisible tab is pure waste: the frames are stale and nobody is
  // aiming at anything. Resuming happens on the next tick after it is visible.
  function onVisibility() {
    if (document.hidden) return
    if (!stopped && frame === 0) frame = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    frame = 0
    if (stopped) return

    if (document.hidden) {
      // Leave the loop parked; `visibilitychange` restarts it.
      return
    }

    if (now - lastDecode >= DECODE_INTERVAL_MS && context && video.readyState >= 2) {
      lastDecode = now

      const width = video.videoWidth
      const height = video.videoHeight
      if (width > 0 && height > 0) {
        const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(width, height))
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)

        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        })

        // The frame is not kept. Only the string it encoded leaves this module.
        if (found?.data) params.onDecode(found.data)
      }
    }

    frame = requestAnimationFrame(tick)
  }

  document.addEventListener('visibilitychange', onVisibility)

  try {
    await video.play()
  } catch {
    // Autoplay can be refused even when muted. The frames still arrive, so the
    // decode loop is started regardless rather than failing the whole scanner.
  }

  frame = requestAnimationFrame(tick)

  return { stop }
}
