import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppLayout } from '~/components/AppLayout'

export const Route = createFileRoute('/_app')({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
})
