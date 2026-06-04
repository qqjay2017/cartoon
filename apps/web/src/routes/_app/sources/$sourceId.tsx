import { createFileRoute } from '@tanstack/react-router'
import { SourceEditorPage } from '~/components/SourceEditorPage'

export const Route = createFileRoute('/_app/sources/$sourceId')({
  component: SourceEditRoute,
})

function SourceEditRoute() {
  const { sourceId } = Route.useParams()
  return <SourceEditorPage mode="edit" sourceId={decodeURIComponent(sourceId)} />
}
