import { createFileRoute } from '@tanstack/react-router'
import { LibraryPage } from '@/components/library/LibraryPage'

export const Route = createFileRoute('/workflows')({ staticData: { title: '工作流模板配置' }, component: () => <LibraryPage kind="workflow" /> })
