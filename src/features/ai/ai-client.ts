import {
  GoogleAIBackend, getAI, getGenerativeModel, type TypedSchema,
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

export const AI_MODEL = 'gemini-3.5-flash'

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
      // `thinkingConfig` is deliberately left at the model's default. Thinking
      // tokens do count against `maxOutputTokens`, which is what made the old
      // 2048 budget too small, but the SDK errors outright if a budget is set
      // outside a model's supported range — a knob worth leaving alone in
      // favour of a budget large enough for both.
      // Search intent and requirement drafts should be reproducible rather than
      // inventive; the creativity that matters here is in the wording the user
      // typed, not in the model's sampling.
      temperature: 0.2,
    },
  })

  const result = await model.generateContent(request.prompt)

  return {
    text: result.response.text(),
    truncated: result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS',
  }
}
