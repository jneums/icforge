import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCanisterControllers, setCanisterControllers } from '@/api';

export function useCanisterControllers(canisterId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['canister-controllers', canisterId],
    queryFn: () => fetchCanisterControllers(canisterId!),
    enabled: enabled && !!canisterId,
  });
}

export function useSetCanisterControllers(canisterId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (controllers: string[]) => {
      if (!canisterId) throw new Error('No canister ID');
      return setCanisterControllers(canisterId, controllers);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canister-controllers', canisterId] });
    },
  });
}
