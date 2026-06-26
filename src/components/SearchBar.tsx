'use client';

import { useState, useEffect, useRef } from 'react';

interface SearchBarProps {
  onSearch:   (query: string) => void;
  placeholder?: string;
  className?:   string;
}

export function SearchBar({
  onSearch,
  placeholder = 'Search…',
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState('');

  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      if (query === '') {
        return;
      }
    }
    onSearchRef.current(query);
  }, [query]);

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
