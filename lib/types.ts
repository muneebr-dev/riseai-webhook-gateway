export type MetaProvider = 'messenger' | 'instagram' | 'whatsapp';
export type Provider = MetaProvider | 'gmail' | 'outlook';

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
