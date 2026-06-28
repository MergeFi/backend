// Domain types shared across the frontend

export type PolicyStatus = 'Active' | 'Expired' | 'Claimed' | 'Cancelled';
export type ClaimStatus  = 'Pending' | 'Processing' | 'Paid' | 'Rejected';
export type TriggerType  = 'Threshold' | 'Binary';
export type Comparison   = 'LessThan' | 'GreaterThan' | 'Equal';
export type Category     = 'crop' | 'flight' | 'disaster' | 'health' | 'defi';

export interface Product {
  id:          string;
  name:        string;
  category:    Category;
  description?: string;
  triggerType: TriggerType;
  threshold:   string;
  comparison:  Comparison;
  coverageMin: string;  // stroops
  coverageMax: string;  // stroops
  premiumRate: number;  // basis points (500 = 5.00%)
  maxDuration: number;  // days
  status:      'Active' | 'Paused' | 'Deprecated';
}

export interface Policy {
  id:           string;
  productId:    string;
  product?:     Product;
  policyholder: string;
  coverage:     string;  // stroops
  premiumPaid:  string;  // stroops
  oracleKey:    string;
  startTime:    number;  // unix epoch seconds
  endTime:      number;  // unix epoch seconds
  cancelledAt?: number;  // unix epoch seconds, set when status === 'Cancelled'
  status:       PolicyStatus;
  contractTxHash?: string;
}

export interface Claim {
  id:           string;
  policyId:     string;
  policy?:      Policy;
  claimant:     string;
  triggerMet:   boolean;
  status:       ClaimStatus;
  oracleValue?: string;
  payoutAmount?: string;
  submittedAt:  number;
  processedAt:  number | null;
  txHash?:      string;
}

export interface OracleReading {
  key:        string;
  dataType:   'weather' | 'flight' | 'defi';
  value:      string;     // 7-decimal fixed point as string
  confidence: number;     // 0–100
  timestamp:  number;     // unix epoch seconds
  source:     string;
}

export interface PoolStats {
  poolId:          string;
  category:        Category;
  totalLiquidity:  string;  // stroops
  activePolicies:  number;
  utilizationRate: number;  // 0–1
  apy:             number;  // annualized yield as decimal
}

export interface PoolShareInfo {
  totalLiquidity: string;  // stroops
  shareSupply:    string;  // total LP shares outstanding
  paused?:        boolean;
}

export interface ProtocolStats {
  totalCoverage:  string;  // stroops — sum of active policy coverage
  activeProducts: number;
  totalPayouts:   string;  // stroops — cumulative paid claims
}

export interface WalletState {
  address:   string | null;
  connected: boolean;
  walletId:  string | null;
  network:   string | null;
}

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id:        string;
  message:   string;
  variant:   ToastVariant;
  duration?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data:    T;
  error?:  string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total:  number;
  page:   number;
  limit:  number;
}
