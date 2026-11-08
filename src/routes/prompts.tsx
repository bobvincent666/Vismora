import { createFileRoute } from '@tanstack/react-router'
import { LibraryPage } from '@/components/library/LibraryPage'

export const Route = createFileRoute('/prompts')({ staticData: { title: '提示词库' }, component: () => <LibraryPage kind="prompt" /> })
