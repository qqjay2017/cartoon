import { createFileRoute } from '@tanstack/react-router'
import { SourcesListPage } from '~/components/SourcesListPage'

export const Route = createFileRoute('/_app/sources/')({
  component: SourcesListPage,
})
