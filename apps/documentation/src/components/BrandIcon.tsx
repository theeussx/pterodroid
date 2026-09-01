type BrandIconProps = {
  name: string;
  label?: string;
  className?: string;
};

export function BrandIcon({ name, label, className = 'h-7 w-7' }: BrandIconProps) {
  const source = `url("/brands/${name}.svg")`;

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block bg-current ${className}`}
      style={{ maskImage: source, WebkitMaskImage: source, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', maskSize: 'contain', WebkitMaskSize: 'contain' }}
    />
  );
}

export const BRAND_ICONS = {
  android: 'android',
  ubuntu: 'ubuntu',
  linux: 'linux',
  docker: 'docker',
  raspberrypi: 'raspberrypi',
  cloudflare: 'cloudflare',
  react: 'react',
  sqlite: 'sqlite',
  postgresql: 'postgresql',
  mariadb: 'mariadb',
  nginx: 'nginx',
  git: 'git',
  github: 'github',
} as const;

export type BrandIconName = (typeof BRAND_ICONS)[keyof typeof BRAND_ICONS];
