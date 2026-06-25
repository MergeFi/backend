'use client';

import { useState } from 'react';
import { useToast } from '@/context/ToastContext';

interface CopyButtonProps {
  text:      string;
  label?:    string;
  className?: string;
}

export function CopyButton({ text, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { show: showToast } = useToast();

  async function handleCopy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'absolute';
        textArea.style.left = '-999999px';
        document.body.prepend(textArea);
        textArea.select();
        try {
          if (!document.execCommand('copy')) {
            throw new Error('execCommand copy failed');
          }
        } catch (error) {
          throw error;
        } finally {
          textArea.remove();
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy failed – please copy the text manually', 'error');
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-400 transition-all hover:border-white/20 hover:text-white active:scale-95 ${className ?? ''}`}
      aria-label={`Copy ${label ?? 'value'}`}
    >
      {copied ? '✓ Copied' : label ?? 'Copy'}
    </button>
  );
}
