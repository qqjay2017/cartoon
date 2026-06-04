import { createFileRoute } from '@tanstack/react-router'
import { AddBookPage } from '~/components/AddBookPage'

export const Route = createFileRoute('/_app/config')({
  component: AddBookPage,
})
