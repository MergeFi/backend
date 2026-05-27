import Link from 'next/link';
import { LogoWordmark } from './Logo';
import { WalletButton } from './WalletButton';

const NAV_LINKS = [
  { href: '/',          label: 'Products'  },
  { href: '/policies',  label: 'My Policies' },
  { href: '/dashboard', label: 'Dashboard'   },
  { href: '/oracle',    label: 'Oracle'      },
  { href: '/pools',     label: 'Risk Pools'  },
];

export function NavBar() {
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
              className="text-gray-400 transition-colors hover:text-white"
            >
              {label}
            </Link>
          ))}
        </div>

        <WalletButton />
      </div>
    </nav>
  );
}
