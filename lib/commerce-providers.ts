import { CommerceProvider } from './types';

const COMMERCE_PROVIDER_ALIASES: Record<string, CommerceProvider> = {
  shopify: 'shopify',
  wix: 'wix',
  woocommerce: 'woocommerce',
  'woo-commerce': 'woocommerce',
  woo_commerce: 'woocommerce',
};

export function normalizeCommerceProvider(
  provider: string,
): CommerceProvider | null {
  return COMMERCE_PROVIDER_ALIASES[provider] ?? null;
}
