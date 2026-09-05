import {
  GoogleAIBackend, getAI, getGenerativeModel, type ThinkingLevel, type TypedSchema,
} from 'firebase/ai'
import { getFirebaseApp } from '@/lib/firebase'

/**
 * The single boundary between the application and the model.
 *
 * Everything above this line is deterministic: prompts are built by pure code,
 * responses are validated by Zod, and identifiers are resolved against real
 * Firestore data. The model is an interpreter of language, never an authority.
 *
 * `AiGenerate` is the seam the two features depend on rather than the SDK, so
 * unit tests stub it and never reach the network.
 */

const AI_MODEL = 'gemini-3.5-flash'

/**
 * How long an interactive AI request may take before it is given up on.
 *
 * The SDK's own default is 180 seconds (`DEFAULT_FETCH_TIMEOUT_MS` in
 * `@firebase/ai`), which is a sane ceiling for a batch job and far too long for
 * somebody who has just pressed a button. Three minutes of a spinner is
 * indistinguishable from a hang, and the usual response is to reload the page —
 * which throws the request away and asks the model again.
 *
 * Thirty seconds is past the slow end of a normal generation and well short of
 * the point where a person concludes the app is broken. Both features share it:
 * Smart Search and the Requirement Generator send comparable prompts to the
 * same model, so there is no measured reason to give one longer than the other,
 * and one policy is one thing to reason about.
 *
 * Passed to the SDK rather than raced against it. `RequestOptions.timeout` is
 * how this SDK version bounds a request — it drives an internal
 * `AbortController` that actually cancels the fetch — whereas a `Promise.race`
 * of our own would leave the request running and the answer discarded.
 */
export const AI_REQUEST_TIMEOUT_MS = 30_000

/** Which feature made the call. Keeps the two distinguishable in code. */
export type AiFeature = 'smart-search' | 'requirement-generator'

export interface StructuredRequest {
  feature: AiFeature
  /** Rules the model must follow, separate from the untrusted user text. */
  systemInstruction: string
  prompt: string
  /** Model-side JSON shape. Zod validates the result again regardless. */
  responseSchema: TypedSchema
  maxOutputTokens: number
  /**
   * How much the model may deliberate before answering.
   *
   * Per request rather than per client, because the two features want
   * different answers to it and they share this function. Absent leaves the
   * model's own default, which is what the Requirement Generator wants: it
   * drafts a production's requirements from a sentence, and thinking is most
   * of the value.
   *
   * `thinkingBudget` is the other half of the same knob and is deliberately
   * never set — the SDK documents that a model errors when both are given.
   */
  thinkingLevel?: ThinkingLevel
}

export interface AiResponse {
  text: string
  /**
   * The model hit `maxOutputTokens` and the text is cut off mid-value.
   *
   * The SDK does not treat this as an error — `MAX_TOKENS` is not in its list
   * of bad finish reasons, so `response.text()` returns the partial text and
   * the failure only surfaces as unreadable JSON several layers later. Carrying
   * it explicitly is what lets the parser salvage the complete part and say
   * what actually happened.
   */
  truncated: boolean
}

export type AiGenerate = (request: StructuredRequest) => Promise<AiResponse>

/**
 * Firebase AI Logic, on the Gemini Developer API backend.
 *
 * `GoogleAIBackend` is the Gemini Developer API and is what the Spark plan
 * covers. `VertexAIBackend` and `AgentPlatformBackend` are the Blaze-only paths
 * and are named here only to say that neither is used. The backend is passed
 * explicitly even though it is the SDK default, so a future default change
 * cannot move this project onto a billed path silently.
 *
 * There is no Gemini API key. The SDK reaches the service through the Firebase
 * app, and App Check — initialized in `getFirebaseApp()` before this runs — is
 * picked up from the same app and sent as `X-Firebase-AppCheck`.
 */
export const generateStructured: AiGenerate = async (request) => {
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })

  const model = getGenerativeModel(ai, {
    model: AI_MODEL,
    systemInstruction: request.systemInstruction,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: request.responseSchema,
      maxOutputTokens: request.maxOutputTokens,
      // Thinking tokens count against `maxOutputTokens`, which is what made the
      // old 2048 budget too small. The level itself is the caller's to choose:
      // omitted here leaves the model's default, and the object is left off
      // entirely rather than sent empty so a request that says nothing about
      // thinking really does say nothing.
      ...(request.thinkingLevel
        ? { thinkingConfig: { thinkingLevel: request.thinkingLevel } }
        : {}),
      // Search intent and requirement drafts should be reproducible rather than
      // inventive; the creativity that matters here is in the wording the user
      // typed, not in the model's sampling.
      temperature: 0.2,
    },
  }, { timeout: AI_REQUEST_TIMEOUT_MS })

  const result = await model.generateContent(request.prompt)

  return {
    text: result.response.text(),
    truncated: result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS',
  }
}
