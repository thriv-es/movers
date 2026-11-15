export type Bindings = {
  MOVERS_BUCKET: R2Bucket
  ENV: 'development' | 'preview' | 'production'
  CF_AIG_TOKEN: string
  PRICE_PER_BOX: string
  /** Workers AI binding (`[ai]` in wrangler.toml). In local dev it calls Workers AI through `wrangler login`. */
  AI?: Ai
  /** Forces the AI backend: `gateway`, `binding` or `mock`. Anything else means auto. See `_lib/ai-mode.ts`. */
  AI_MODE?: string
  /** D1 database for saved estimates, movers and quote requests. Without it the API keeps records in memory. */
  MOVERS_DB?: D1Database
}
