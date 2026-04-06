import { useQuery } from '@tanstack/react-query';
import { fetchCanisterEnv } from '@/api';

export function useCanisterEnv(canisterId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['canister-env', canisterId],
    queryFn: () => fetchCanisterEnv(canisterId!),
    enabled: enabled && !!canisterId,
  });
}
