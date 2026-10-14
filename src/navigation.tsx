'use client';

import NextLink, { type LinkProps as NextLinkProps } from 'next/link';
import { usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';
import { useCallback, useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & Omit<NextLinkProps, 'href'> & {
  to: string;
  children?: ReactNode;
};

export function Link({ to, ...props }: LinkProps) {
  return <NextLink href={to} {...props} />;
}

export function useLocation() {
  const pathname = usePathname();
  const params = useNextSearchParams();
  const search = params.toString();
  return useMemo(() => ({ pathname, search: search ? `?${search}` : '' }), [pathname, search]);
}

export function useNavigate() {
  const router = useRouter();
  return useCallback((destination: string | number, options?: { replace?: boolean }) => {
    if (typeof destination === 'number') {
      if (destination < 0) router.back();
      else if (destination > 0) router.forward();
      return;
    }
    if (options?.replace) router.replace(destination);
    else router.push(destination);
  }, [router]);
}

type SearchParamsInput = URLSearchParams | Record<string, string> | ((current: URLSearchParams) => URLSearchParams | Record<string, string>);

export function useSearchParams(): [URLSearchParams, (next: SearchParamsInput, options?: { replace?: boolean }) => void] {
  const current = useNextSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const params = useMemo(() => new URLSearchParams(current.toString()), [current]);
  const setParams = useCallback((next: SearchParamsInput, options?: { replace?: boolean }) => {
    const value = typeof next === 'function' ? next(new URLSearchParams(current.toString())) : next;
    const query = value instanceof URLSearchParams ? value : new URLSearchParams(value);
    const destination = query.size ? `${pathname}?${query}` : pathname;
    if (options?.replace) router.replace(destination);
    else router.push(destination);
  }, [current, pathname, router]);
  return [params, setParams];
}
