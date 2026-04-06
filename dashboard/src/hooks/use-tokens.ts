import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTokens, createToken, revokeToken } from '@/api';

export function useTokens() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: listTokens,
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createToken(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}
