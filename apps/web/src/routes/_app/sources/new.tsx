import { createFileRoute } from '@tanstack/react-router'
import { SourceEditorPage } from '~/components/SourceEditorPage'

export const Route = createFileRoute('/_app/sources/new')({
  component: () => <SourceEditorPage mode="create" />,
})
