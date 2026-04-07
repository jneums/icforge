import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject } from '@/api/projects';
import { linkRepo } from '@/api/github';

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useLinkRepo() {
  return useMutation({
    mutationFn: linkRepo,
  });
}
