import type { PageProps } from 'prunelle'
import { Card, CardBody, CardHeader } from '@prunellejs/ui'

export default async function DashboardPage({ locals }: PageProps) {
  return (
    <Card>
      <CardHeader>Dashboard</CardHeader>
      <CardBody>
        <p class="m-0">Signed in as <strong>{locals.user?.email}</strong>.</p>
      </CardBody>
    </Card>
  )
}
