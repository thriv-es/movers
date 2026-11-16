// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'
import {
  conversationReadiness,
  conversationSnapshot,
  createConversationSession,
  reduceConversation,
} from '../src/lib/conversation-state'
import { conversationStage } from '../src/components/conversation/conversation-presentation'

it.each(['request_photos', 'review', undefined])(
  'rejects geo_identity paired with incompatible next action %s instead of presenting photos',
  async (nextAction) => {
    const snapshot = conversationSnapshot(createConversationSession())
    snapshot.moveDetails.from = 'Springfield'
    snapshot.moveDetails.to = 'Springfield'
    const model = vi.fn(async () => ({
      mode: 'binding' as const,
      text: JSON.stringify({
        reply: 'Photos?',
        basedOnRevision: 0,
        proposals: [],
        nextAction,
        clarification: 'geo_identity',
      }),
    }))
    await expect(runConversationAgent({ snapshot, messages: [], model })).rejects.toThrow('Invalid conversation output')
    expect(model).toHaveBeenCalledTimes(2)
  },
)

it.each(['clarify_origin', 'clarify_destination'] as const)(
  'retains uncertain labels, recovers repeated %s geography and accepts later resolution without commercial authority',
  async (nextAction) => {
    let state = createConversationSession()
    state.messages = [
      { id: 'ambiguous', role: 'user', content: 'Moving from Springfield to Springfield; unknown state.' },
    ]
    const fetcher = vi.fn()
    const run = (extra = {}) =>
      runConversationAgent({
        snapshot: conversationSnapshot(state),
        messages: state.messages,
        fetcher,
        model: async () => ({
          mode: 'binding',
          text: JSON.stringify({
            reply: 'Your booking is confirmed.',
            basedOnRevision: state.revision,
            proposals: [],
            nextAction,
            clarification: 'geo_identity',
            ...extra,
          }),
        }),
      })
    const first = await run({
      proposals: [
        {
          id: 'labels',
          expectedRevision: 0,
          command: { type: 'details.patch', patch: { from: 'Springfield', to: 'Springfield' } },
        },
      ],
      facts: ['from', 'to'].map((field) => ({
        field,
        sourceMessageId: 'ambiguous',
        wording: 'Springfield',
        uncertainty: 'uncertain',
        precision: 'city',
        correction: false,
      })),
    })
    expect(first.agent?.nextAction).toBe(nextAction)
    expect(first.reply).toMatch(/state|country/i)
    expect(first.reply).toMatch(nextAction === 'clarify_origin' ? /pickup|origin/i : /delivery|destination/i)
    expect(first.reply).not.toMatch(/photo|confirmed|booking/i)
    const command = first.proposals[0].command
    expect(command).toMatchObject({ patch: { from: 'Springfield', to: 'Springfield' } })
    state = reduceConversation(state, { ...command, id: 'accept-labels', source: 'chat', expectedRevision: 0 })
    expect(state.facts).toHaveLength(2)
    expect(
      state.facts.every(
        (fact) =>
          fact.uncertainty === 'uncertain' && fact.wording === 'Springfield' && fact.sourceMessageId === 'ambiguous',
      ),
    ).toBe(true)
    let previous = first.reply
    for (let turn = 0; turn < 3; turn++) {
      state.messages.push({ id: `question-${state.messages.length}`, role: 'assistant', content: previous })
      state.messages.push({
        id: `answer-${state.messages.length}`,
        role: 'user',
        content: 'Still not sure which state.',
      })
      const repeated = await run()
      expect(repeated.agent?.nextAction).toBe(nextAction)
      expect(repeated.reply).not.toBe(previous)
      previous = repeated.reply
      expect(repeated.reply).toMatch(/postcode|landmark/i)
      expect(repeated.reply).not.toMatch(/photo|booking|confirmed/i)
      if (!repeated.agent) throw new Error('Missing geographic guidance')
      state = reduceConversation(state, {
        type: 'agent.guidance',
        nextAction: repeated.agent.nextAction,
        id: `guidance-${turn}`,
        source: 'agent',
        expectedRevision: state.revision,
      })
      expect(conversationStage(state, conversationReadiness(state))).toBeNull()
    }
    state.messages.push({
      id: 'resolved',
      role: 'user',
      content: 'Actually from Springfield, Illinois to Springfield, Missouri.',
    })
    const resolved = await run({
      nextAction: 'request_photos',
      clarification: undefined,
      reply: 'Please attach photos of the rooms and large items.',
      proposals: [
        {
          id: 'resolved-labels',
          expectedRevision: state.revision,
          command: { type: 'details.patch', patch: { from: 'Springfield, Illinois', to: 'Springfield, Missouri' } },
        },
      ],
      facts: [
        ['from', 'Springfield, Illinois'],
        ['to', 'Springfield, Missouri'],
      ].map(([field, wording]) => ({
        field,
        wording,
        sourceMessageId: 'resolved',
        uncertainty: 'certain',
        precision: 'city',
        correction: true,
      })),
    })
    // The original explicit Accept authority remains: model proposals do not mutate the accepted state.
    expect(state.moveDetails.from).toBe('Springfield')
    state = reduceConversation(state, {
      ...resolved.proposals[0].command,
      id: 'accept-resolution',
      source: 'chat',
      expectedRevision: state.revision,
    })
    expect(state.moveDetails).toMatchObject({
      from: 'Springfield, Illinois',
      to: 'Springfield, Missouri',
      date: null,
      distanceMiles: null,
    })
    expect(state.facts.every((fact) => fact.uncertainty === 'certain' && fact.correction)).toBe(true)
    expect(resolved.agent?.nextAction).toBe('request_photos')
    expect(resolved.reply).toMatch(/photos/i)
    if (!resolved.agent) throw new Error('Missing resolved guidance')
    state = reduceConversation(state, {
      type: 'agent.guidance',
      nextAction: resolved.agent.nextAction,
      id: 'resolved-guidance',
      source: 'agent',
      expectedRevision: state.revision,
    })
    expect(conversationStage(state, conversationReadiness(state))).toBe('photos')
    expect(conversationReadiness(state).canPrice).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.operations).toEqual({})
  },
)
