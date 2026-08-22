import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { paths } from '@/routes/paths'

export function NotFound() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you are looking for does not exist.
        </p>
      </div>
      <Button asChild>
        <Link to={paths.dashboard}>Back to Dashboard</Link>
      </Button>
    </div>
  )
}
