export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  QUEUE: Queue;
  ENV: 'development' | 'production';
  AI_GATEWAY_AUTH_TOKEN: string;
  AI_GATEWAY_PROJECT_NAME: string;
  PRICE_PER_BOX: string;
};

export const AI_GATEWAY_URL = 'https://ai-gateway.nxty.ai';

