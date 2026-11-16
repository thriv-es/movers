import { EMPTY_MOVE_DETAILS, type VisionStatus } from '../../../src/data'
import type { resolveRole } from './ai-mode'
import { photoAssessmentPrompt } from './prompts'

/** Hash only vision-affecting settings. Global Chat/Pricing revisions must not invalidate a vision draft. */
export async function visionStatus(role: Awaited<ReturnType<typeof resolveRole>>): Promise<VisionStatus> {
  const identity = JSON.stringify({
    mode: role.mode,
    backend: role.selection.backend,
    model: role.selection.model,
    prompt: photoAssessmentPrompt(EMPTY_MOVE_DETAILS),
    inventoryPrivacyVersion: 2,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return {
    visionRevision: role.revision,
    visionFingerprint: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  }
}
