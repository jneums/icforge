import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCanisterEnv, setCanisterEnv } from '@/api';
import type { EnvironmentVariable } from '@/api';

export function useCanisterEnv(canisterId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['canister-env', canisterId],
    queryFn: () => fetchCanisterEnv(canisterId!),
    enabled: enabled && !!canisterId,
  });
}

export function useSetCanisterEnv(canisterId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (envVars: EnvironmentVariable[]) => {
      if (!canisterId) throw new Error('No canister ID');
      return setCanisterEnv(canisterId, envVars);
    },
    onSuccess: () => {
      // Invalidate the env query so it refetches the new values
      queryClient.invalidateQueries({ queryKey: ['canister-env', canisterId] });
    },
  });
}
