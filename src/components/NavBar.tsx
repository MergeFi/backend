'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { LogoWordmark } from './Logo';
import { WalletButton } from './WalletButton';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

const NAV_LINKS = [
  { href: '/',          label: 'Products'  },
  { href: '/policies',  label: 'My Policies' },
  { href: '/dashboard', label: 'Dashboard'   },
  { href: '/oracle',    label: 'Oracle'      },
  { href: '/pools',     label: 'Risk Pools'  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function NavBar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useKeyboardShortcut('Escape', () => setMobileMenuOpen(false));

  return (
    <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/">
          <LogoWordmark size={28} />
        </Link>

        <div className="hidden items-center gap-6 text-sm md:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`transition-colors hover:text-white ${
                isActive(pathname, href)
                  ? 'text-white border-b-2 border-teal-400 pb-0.5'
                  : 'text-gray-400'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <WalletButton />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-400 hover:text-white"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-gray-950">
          <div className="px-6 py-4 space-y-3">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block py-2 text-sm transition-colors hover:text-white ${
                  isActive(pathname, href)
                    ? 'text-white border-b-2 border-teal-400 pb-0.5'
                    : 'text-gray-400'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
