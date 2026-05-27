import Image from 'next/image';
import logoDark  from '../../assets/parashield-logo-dark.png';
import logoLight from '../../assets/parashield-logo-light.png';

interface LogoProps {
  variant?: 'dark' | 'light';
  size?:    number;
  className?: string;
}

export function Logo({ variant = 'dark', size = 32, className }: LogoProps) {
  const src = variant === 'light' ? logoLight : logoDark;
  return (
    <Image
      src={src}
      alt="ParaShield"
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}

export function LogoWordmark({ variant = 'dark', size = 32, className }: LogoProps) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ''}`}>
      <Logo variant={variant} size={size} />
      <span className="text-lg font-bold tracking-tight">
        <span className="text-teal-400">Para</span>
        <span className={variant === 'dark' ? 'text-white' : 'text-gray-900'}>shield</span>
      </span>
    </span>
  );
}
