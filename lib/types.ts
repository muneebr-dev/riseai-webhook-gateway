export type MetaProvider = 'messenger' | 'instagram' | 'whatsapp';
export type BookingProvider =
  | 'google_calendar'
  | 'outlook_calendar'
  | 'calendly'
  | 'square_appointments';

export type CommerceProvider = 'shopify' | 'wix' | 'woocommerce';

export type Provider =
  | MetaProvider
  | 'gmail'
  | 'outlook'
  | 'stripe'
  | BookingProvider
  | CommerceProvider;

export type ForwardResult = {
  target: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
};

export type ForwardBatchResult = {
  requestId: string;
  provider: Provider;
  targetCount: number;
  results: ForwardResult[];
  successCount: number;
  failureCount: number;
};
