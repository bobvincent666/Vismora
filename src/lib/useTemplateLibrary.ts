import { useQuery } from '@tanstack/react-query'
import { idbRead } from './idbStorage'
import { LIBRARY_KEY, normalizeEntry, type LibraryEntry } from './templateLibrary'

export const TEMPLATE_LIBRARY_QUERY_KEY = ['template-library'] as const
export function useTemplateLibrary() {
  return useQuery({
    queryKey: TEMPLATE_LIBRARY_QUERY_KEY,
    queryFn: async () => {
      const value = await idbRead<LibraryEntry[]>(LIBRARY_KEY)
      if (value && !Array.isArray(value)) throw new Error('本地模板库格式异常')
      return (value || []).map(entry => normalizeEntry(entry, entry.kind))
    },
    staleTime: 0,
  })
}
