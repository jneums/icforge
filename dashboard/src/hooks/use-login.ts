import { useMutation } from '@tanstack/react-query';
import { devLogin } from '@/api/auth';

export function useDevLogin() {
  return useMutation({
    mutationFn: devLogin,
  });
}
