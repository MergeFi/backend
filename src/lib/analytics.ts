import posthog from 'posthog-js';

type EventName =
  | 'wallet_connect'
  | 'wallet_disconnect'
  | 'policy_buy_start'
  | 'policy_buy_success'
  | 'policy_buy_error'
  | 'claim_submit'
  | 'claim_success'
  | 'claim_error'
  | 'product_view'
  | 'oracle_refresh'
  | 'app_error';

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

function truncateWalletAddress(address?: string): string | undefined {
  if (!address) return undefined;
  return address.slice(0, 8);
}

export function track(event: EventName, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;
  
  const sanitizedProperties = { ...properties };
  if (sanitizedProperties.wallet && typeof sanitizedProperties.wallet === 'string') {
    sanitizedProperties.wallet = truncateWalletAddress(sanitizedProperties.wallet);
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.debug('[analytics]', event, sanitizedProperties);
  }
  
  posthog.capture(event, sanitizedProperties);
}

export function page(name: string, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;
  
  if (process.env.NODE_ENV === 'development') {
    console.debug('[analytics:page]', name, properties);
  }
  
  posthog.capture('$pageview', { 
    $current_url: window.location.href,
    ...properties 
  });
}
