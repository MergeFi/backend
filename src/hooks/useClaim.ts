'use client';

import { useState, useCallback, useEffect } from 'react';
import { fetchClaim, fetchUserClaims } from '@/lib/api';
import type { Claim } from '@/types';
import { toUserMessage } from '@/lib/errors';
import { invokeSubmitClaim } from '@/lib/contract';
import { useWallet } from '@/hooks/useWallet';

type ClaimStep = 'idle' | 'submitting' | 'polling' | 'done' | 'timeout' | 'error';

export function useClaim(policyId?: string) {
  const { address } = useWallet();
  const [step,    setStep]    = useState<ClaimStep>('idle');
  const [claimId, setClaimId] = useState<string | null>(null);
  const [claim,   setClaim]   = useState<Claim | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Fetch existing claim for this policy on load
  useEffect(() => {
    const walletAddress = address;
    if (!walletAddress || !policyId) {
      setStep('idle');
      setClaim(null);
      setClaimId(null);
      return;
    }

    let active = true;
    async function checkExistingClaim() {
      try {
        const claims = await fetchUserClaims(walletAddress!);
        if (!active) return;
        const existingClaim = claims.find((c) => c.policyId === policyId);
        if (existingClaim) {
          setClaim(existingClaim);
          setClaimId(existingClaim.txHash ?? existingClaim.id);
          if (existingClaim.status === 'Paid' || existingClaim.status === 'Rejected') {
            setStep('done');
          } else {
            setStep('polling');
          }
        } else {
          setStep('idle');
          setClaim(null);
          setClaimId(null);
        }
      } catch (err) {
        console.error('Failed to fetch existing claim:', err);
      }
    }

    void checkExistingClaim();

    return () => {
      active = false;
    };
  }, [address, policyId]);

  // Polling loop for pending/processing claims
  useEffect(() => {
    if (step !== 'polling' || !claimId) return;

    const currentClaimId = claimId;
    let active = true;
    let timer: NodeJS.Timeout;
    let count = 0;

    async function poll() {
      try {
        const result = await fetchClaim(currentClaimId);
        if (!active) return;
        if (result) {
          setClaim(result);
          if (result.status === 'Paid' || result.status === 'Rejected') {
            setStep('done');
            return;
          }
        }
      } catch (err) {
        console.error('Error polling claim:', err);
      }

      count++;
      if (count >= 20) {
        setStep('timeout');
      } else {
        timer = setTimeout(poll, 3000);
      }
    }

    timer = setTimeout(poll, 3000);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [step, claimId]);

  const submit = useCallback(async (claimant: string, policyId: string) => {
    setStep('submitting');
    setError(null);
    try {
      const txHash = await invokeSubmitClaim(claimant, policyId);
      setClaimId(txHash);
      setStep('polling');
      return { error: null };
    } catch (err) {
      const errorMsg = toUserMessage(err);
      setError(errorMsg);
      setStep('error');
      return { error: errorMsg };
    }
  }, []);

  const reset = useCallback(() => {
    setStep('idle');
    setClaimId(null);
    setClaim(null);
    setError(null);
  }, []);

  return { step, claimId, claim, error, submit, reset };
}
