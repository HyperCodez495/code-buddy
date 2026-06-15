// Deprecated: Forwarding to new ELK layout implementation
import { useElkLayout } from './layout/useElkLayout';

export function useAutoLayout() {
  const { performAutoLayout, isLayingOut } = useElkLayout();
  return { performAutoLayout, isLayingOut };
}