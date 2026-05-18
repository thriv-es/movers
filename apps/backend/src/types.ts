export type Bindings = {
  MOVERS_BUCKET: R2Bucket;
  ENV: 'development' | 'production';
  AI_GATEWAY_AUTH_TOKEN: string;
  AI_GATEWAY_PROJECT_NAME: string;
  PRICE_PER_BOX: string;
};

export const AI_GATEWAY_URL = 'https://ai-gateway.nxty.ai';

