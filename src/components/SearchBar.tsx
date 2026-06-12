'use client';

import { useDebounce } from '@/hooks/useDebounce';
import { useState, useEffect } from 'react';

interface SearchBarProps {
  onSearch:   (query: string) => void;
  placeholder?: string;
  className?:   string;
  debounceMs?:  number;
}

export function SearchBar({
  onSearch,
  placeholder = 'Search…',
  className,
  debounceMs = 300,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const debounced         = useDebounce(query, debounceMs);

  useEffect(() => {
    onSearch(debounced);
  }, [debounced, onSearch]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
        🔍
      </span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-4 text-sm text-white placeholder:text-gray-600 focus:border-teal-500 focus:outline-none"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-white transition-colors"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}
