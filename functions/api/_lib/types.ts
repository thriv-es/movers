export type Bindings = {
  MOVERS_BUCKET: R2Bucket;
  ENV: 'development' | 'production';
  CF_AIG_TOKEN: string;
  PRICE_PER_BOX: string;
};
