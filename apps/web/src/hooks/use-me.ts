import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query';
import { getMe } from '@/lib/api/me';

/** The signed-in user's profile and quota (`GET /api/me`), shared by every consumer. */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe });
}
