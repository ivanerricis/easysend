import { useEffect } from 'react';
import { useAppearance } from '@/app/providers/AppearanceProvider';

/** Sets `document.title` to "<title> · <instance name>". `PageHeader` calls it for you. */
export function usePageTitle(title: string): void {
  const { instanceName } = useAppearance();
  useEffect(() => {
    document.title = title ? `${title} · ${instanceName}` : instanceName;
  }, [title, instanceName]);
}
