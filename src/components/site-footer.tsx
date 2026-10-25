'use client';

import { useAuth } from '@/components/auth';

/** 全站统一页脚：版本号 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-line py-4">
      <p className="text-center text-xs text-faint">
        聚影{version ? ` v${version}` : ''}
        {' · '}
        AGPL-3.0 License
      </p>
    </footer>
  );
}
