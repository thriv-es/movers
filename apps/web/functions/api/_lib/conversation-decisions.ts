import { z } from 'zod'
import type { ConversationRoute, ConversationSnapshot } from '../../../src/data/z-common/z-conversation'
import type { AiResult } from './ai-client'

/** Closed read-only intent: endpoints and network destinations are NEVER model parameters. */
export const zConversationToolIntent = z.object({ type: z.literal('resolve_route') }).strict()
export type ConversationToolIntent = z.infer<typeof zConversationToolIntent>
export interface ConversationToolResult {
  type: 'resolve_route'
  route: ConversationRoute
}
export interface ConversationModelRequest {
  phase: 'interpret' | 'continue'
  retry: boolean
  snapshot: ConversationSnapshot
  toolResults: ConversationToolResult[]
}
export type ConversationModel = (request: ConversationModelRequest) => Promise<AiResult>
